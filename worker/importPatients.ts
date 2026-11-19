import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID } from "./env";
import { who, type AppEnv } from "./auth";
import { audit } from "./trash";
import { checkPhone, EMAIL } from "../shared/phone";
import type { ImportRow } from "../shared/importPatients";

type C = Context<AppEnv>;
const MAX_ROWS = 500;
/** Who counts as the same person: same name and mobile, or without a mobile, same name and birth year. */
const key = (name: string, phone: string, birthYear: number | null) => `${name.toLowerCase().replace(/\s+/g, " ")}|${phone || `y${birthYear ?? ""}`}`;

/**
 * Adds patients from an old spreadsheet, a batch at a time (the screen sends 500 per request).
 * Keeps their old patient ID and file number when given, skips anyone already here,
 * and moves the CJ / DCJ counters past the highest imported number so new patients don't clash.
 */
export async function importPatients(c: C) {
  const b = await c.req.json<{ rows?: ImportRow[] }>().catch(() => ({} as { rows?: ImportRow[] }));
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, MAX_ROWS) : [];
  if (!rows.length) return c.json({ error: "No patients to add." }, 400);
  const d = drizzle(c.env.DB, { schema: s });

  const existing = await d.select({ code: s.patients.code, name: s.patients.name, phone: s.patients.phone, fileNo: s.patients.fileNo, birthYear: s.patients.birthYear })
    .from(s.patients).where(eq(s.patients.clinicId, CLINIC_ID));
  const codes = new Set(existing.map((p) => p.code.toUpperCase()));
  const codeName = new Map(existing.map((p) => [p.code.toUpperCase(), p.name.toLowerCase().replace(/\s+/g, " ")]));
  const people = new Set(existing.map((p) => key(p.name, p.phone, p.birthYear)));
  const files = new Set(existing.map((p) => (p.fileNo ?? "").toUpperCase()).filter(Boolean));

  const counters = Object.fromEntries((await d.select().from(s.counters).where(eq(s.counters.clinicId, CLINIC_ID))).map((r) => [r.series, r.next]));
  let nextCode = counters.patient ?? 1;
  let maxCode = 0, maxFile = 0;

  const norm = (v: unknown) => { const t = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 30); return /^\d+$/.test(t) ? `CJ${Number(t)}` : t; };
  // IDs some rows bring with them, so rows without one aren't given the same number.
  const wanted = new Set(rows.map((r) => norm(r.code)).filter(Boolean));
  const skipped: { name: string; reason: string }[] = [];
  const inserts: (typeof s.patients.$inferInsert)[] = [];
  const now = new Date().toISOString();
  const year = new Date().getFullYear();

  for (const r of rows) {
    const name = String(r.name ?? "").trim().slice(0, 120);
    if (!name) { skipped.push({ name: "(no name)", reason: "No name" }); continue; }
    const cc = String(r.phoneCc ?? "91").replace(/\D/g, "") || "91";
    let phone = String(r.phone ?? "").replace(/\D/g, "");
    if (phone && checkPhone(cc, phone)) phone = "";

    const birthYear = Number.isInteger(r.birthYear) && r.birthYear! > year - 110 && r.birthYear! <= year ? r.birthYear! : null;
    if (people.has(key(name, phone, birthYear))) { skipped.push({ name, reason: phone ? "Already here (same name and mobile)" : "Already here (same name and age, no mobile)" }); continue; }
    let code = norm(r.code);
    let oldCode: string | null = null;
    if (code && codes.has(code)) {
      // Same ID and same name: the same person, already here. Same ID, different person: give them a new ID.
      if (codeName.get(code) === name.toLowerCase().replace(/\s+/g, " ")) { skipped.push({ name, reason: `Already here as ${code}` }); continue; }
      oldCode = code; code = "";
    }
    if (!code) { while (codes.has(`CJ${nextCode}`) || wanted.has(`CJ${nextCode}`)) nextCode++; code = `CJ${nextCode++}`; }
    const cj = code.match(/^CJ(\d+)$/); if (cj) maxCode = Math.max(maxCode, Number(cj[1]));

    let fileNo = r.fileNo ? String(r.fileNo).trim().toUpperCase().slice(0, 30) : null;
    if (fileNo && /^\d+$/.test(fileNo)) fileNo = `DCJ-${Number(fileNo)}`;
    if (fileNo && files.has(fileNo)) fileNo = null; // keep the patient; the clash shows in notes below
    const fm = fileNo?.match(/^DCJ-(\d+)$/); if (fm) maxFile = Math.max(maxFile, Number(fm[1]));

    const email = r.email && EMAIL.test(String(r.email).trim().toLowerCase()) ? String(r.email).trim().toLowerCase() : null;
    const alerts = Array.isArray(r.alerts) ? r.alerts.map((a) => String(a).trim().slice(0, 80)).filter(Boolean).slice(0, 20) : [];
    const created = r.createdAt && /^\d{4}-\d{2}-\d{2}$/.test(r.createdAt) && r.createdAt <= now.slice(0, 10) ? `${r.createdAt}T06:30:00.000Z` : now;
    const notes = [r.notes ? String(r.notes).slice(0, 2000) : "", r.fileNo && !fileNo ? `Old file no. ${r.fileNo} (already used by another patient)` : "", oldCode ? `Old patient ID ${oldCode} (already used by another patient)` : ""].filter(Boolean).join("\n") || null;

    codes.add(code); codeName.set(code, name.toLowerCase().replace(/\s+/g, " "));
    if (fileNo) files.add(fileNo);
    people.add(key(name, phone, birthYear));
    inserts.push({
      id: crypto.randomUUID(), clinicId: CLINIC_ID, code, fileNo, name, phone, phoneCc: cc, email,
      gender: r.gender === "F" || r.gender === "M" || r.gender === "O" ? r.gender : null,
      birthYear, alertsJson: JSON.stringify(alerts), notes, whatsappConsent: !!phone, createdAt: created,
    });
  }

  const statements = inserts.map((v) => d.insert(s.patients).values(v));
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100);
    if (chunk.length) await d.batch(chunk as [typeof chunk[0], ...typeof chunk]);
  }
  // New patients carry on after the highest number used so far, imported or not.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE counters SET next = MAX(next, ?) WHERE clinic_id = ? AND series = 'patient'").bind(Math.max(maxCode + 1, nextCode), CLINIC_ID),
    c.env.DB.prepare("UPDATE counters SET next = MAX(next, ?) WHERE clinic_id = ? AND series = 'file'").bind(maxFile + 1, CLINIC_ID),
  ]);
  if (inserts.length) await audit(d, who(c), "import", "patient", String(inserts.length), { added: inserts.length, skipped: skipped.length });
  return c.json({ added: inserts.length, skipped });
}
