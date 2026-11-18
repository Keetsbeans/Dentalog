import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { audit } from "./trash";
import { isTooth } from "../shared/teeth";

/*
 * Patient files of any type: X-rays, photos, consent forms, reports, PDFs, Word files, scans.
 * The bytes live in R2; the files table keeps who, what and where.
 */

type C = Context<{ Bindings: Env }>;
const db = (env: Env) => drizzle(env.DB, { schema: s });
export const FILE_KINDS = ["xray", "photo", "consent", "document", "other"] as const;
type Kind = (typeof FILE_KINDS)[number];
/** 25 MB each: enough for a full-mouth series or a CBCT report PDF. */
export const MAX_FILE = 25 * 1024 * 1024;
const NO_STORAGE = { error: "File storage isn’t switched on yet." };

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
const cols = { id: s.files.id, kind: s.files.kind, tooth: s.files.tooth, note: s.files.note, filename: s.files.filename, contentType: s.files.contentType, bytes: s.files.bytes, createdAt: s.files.createdAt, visitId: s.files.visitId };

export async function listFiles(c: C) {
  const rows = await db(c.env).select(cols).from(s.files)
    .where(and(eq(s.files.clinicId, CLINIC_ID), eq(s.files.patientId, c.req.param("id")!), isNull(s.files.deletedAt)))
    .orderBy(desc(s.files.createdAt));
  return c.json(rows);
}

export async function uploadFile(c: C) {
  if (!c.env.FILES) return c.json(NO_STORAGE, 503);
  const pid = c.req.param("id")!;
  const [p] = await db(c.env).select({ id: s.patients.id }).from(s.patients)
    .where(and(eq(s.patients.id, pid), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!p) return c.json({ error: "That patient was not found." }, 404);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return c.json({ error: "Choose a file to upload." }, 400);
  if (!file.size) return c.json({ error: `“${file.name}” is empty.` }, 400);
  if (file.size > MAX_FILE) return c.json({ error: `“${file.name}” is over 25 MB. Try a smaller copy.` }, 400);
  const kind = (FILE_KINDS as readonly string[]).includes(String(form.get("kind"))) ? (String(form.get("kind")) as Kind) : "other";
  const tooth = String(form.get("tooth") ?? "").trim() || null;
  if (tooth && !tooth.split(/[,\s]+/).every((t) => isTooth(Number(t)))) return c.json({ error: "Check the tooth number (like 16 or 36, 46)." }, 400);
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;
  const visitId = String(form.get("visitId") ?? "").trim() || null;

  const id = crypto.randomUUID();
  const filename = safeName(file.name);
  const r2Key = `${CLINIC_ID}/patients/${pid}/${id}`;
  const contentType = file.type || "application/octet-stream";
  await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType } });
  const row = { id, clinicId: CLINIC_ID, patientId: pid, visitId, kind, tooth, note, r2Key, filename, contentType, bytes: file.size, createdAt: new Date().toISOString() };
  try { await db(c.env).insert(s.files).values(row); }
  catch (e) { await c.env.FILES.delete(r2Key); throw e; }
  await audit(db(c.env), CLINIC_ID, "upload", "file", id, { kind, bytes: file.size });
  const { r2Key: _k, clinicId: _c, patientId: _p, ...out } = row;
  return c.json(out);
}

/** Opens the file. `?download=1` saves it instead. Only for signed-in users. */
export async function getFile(c: C) {
  if (!c.env.FILES) return c.json(NO_STORAGE, 503);
  const [f] = await db(c.env).select().from(s.files).where(and(eq(s.files.id, c.req.param("id")!), eq(s.files.clinicId, CLINIC_ID)));
  if (!f) return c.json({ error: "That file was not found." }, 404);
  const obj = await c.env.FILES.get(f.r2Key);
  if (!obj) return c.json({ error: "That file is missing from storage." }, 404);
  // Anything that could run script (a web page, an SVG) is only ever downloaded, never opened as part of Dentalog.
  const risky = /html|svg|xml|javascript/i.test(f.contentType);
  const how = c.req.query("download") || risky ? "attachment" : "inline";
  return new Response(obj.body, {
    headers: {
      "content-type": risky ? "application/octet-stream" : f.contentType,
      "content-length": String(f.bytes),
      "content-disposition": `${how}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Change the type, tooth or note of a file. */
export async function editFile(c: C) {
  const b = await c.req.json<{ kind?: string; tooth?: string | null; note?: string | null }>();
  const set: Partial<typeof s.files.$inferInsert> = {};
  if (b.kind !== undefined) { if (!(FILE_KINDS as readonly string[]).includes(b.kind)) return c.json({ error: "Unknown file type." }, 400); set.kind = b.kind as Kind; }
  if (b.tooth !== undefined) {
    const t = b.tooth?.trim() || null;
    if (t && !t.split(/[,\s]+/).every((x) => isTooth(Number(x)))) return c.json({ error: "Check the tooth number." }, 400);
    set.tooth = t;
  }
  if (b.note !== undefined) set.note = b.note?.trim().slice(0, 200) || null;
  const id = c.req.param("id")!;
  await db(c.env).update(s.files).set(set).where(and(eq(s.files.id, id), eq(s.files.clinicId, CLINIC_ID)));
  await audit(db(c.env), CLINIC_ID, "update", "file", id, Object.keys(set));
  return c.json({ ok: true });
}
