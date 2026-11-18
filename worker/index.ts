import { Hono } from "hono";
import { and, asc, desc, eq, gte, isNotNull, isNull, like, lt, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { login, logout, me, requireSession } from "./auth";
import { audit, isTrashKind, purgeExpired, purgeOne, restore, softDelete, type TrashKind } from "./trash";
import { daysLeft, removalDate } from "../shared/trash";
import { formatNumber, type Series } from "../shared/numbering";
import { istToUtc, label12, overlaps, utcToIst, type Hours } from "../shared/time";
import { readSettings, type ClinicSettings } from "../shared/settings";
import { directions, quantity, type Food } from "../shared/rx";
import { findDrug, penicillinAllergy } from "../shared/drugs";
import { billTotal, PAY_MODES, type PayMode } from "../shared/services";
import { amountInWords, rupees } from "../shared/money";
import { buildReport } from "./reports";
import { logSent, queue, sentLog } from "./messages";

const app = new Hono<{ Bindings: Env }>().basePath("/api");
const db = (env: Env) => drizzle(env.DB, { schema: s });

app.use("*", requireSession);
app.get("/health", (c) => c.json({ ok: true, app: "Dentalog" }));
app.post("/login", login);
app.post("/logout", logout);
app.get("/me", me);

async function clinicSettings(env: Env) {
  const [clinic] = await db(env).select({ j: s.clinics.settingsJson }).from(s.clinics).where(eq(s.clinics.id, CLINIC_ID));
  return readSettings(clinic?.j);
}

app.get("/clinic", async (c) => {
  const [clinic] = await db(c.env).select().from(s.clinics).where(eq(s.clinics.id, CLINIC_ID));
  return clinic ? c.json({ ...clinic, settings: readSettings(clinic.settingsJson) }) : c.json({ error: "Clinic not set up yet." }, 404);
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Settings → Save. Only the fields sent are changed. */
app.put("/clinic", async (c) => {
  const b = await c.req.json<{
    name?: string; doctorName?: string; qualification?: string | null; phone?: string | null; address?: string | null;
    email?: string | null; website?: string | null; upiId?: string | null; hours?: Hours; settings?: ClinicSettings;
  }>();
  const set: Partial<typeof s.clinics.$inferInsert> = {};
  const txt = (v?: string | null) => (v === undefined ? undefined : v?.trim() || null);
  if (b.name !== undefined) { if (!b.name.trim()) return c.json({ error: "Enter the clinic name." }, 400); set.name = b.name.trim(); }
  if (b.doctorName !== undefined) { if (!b.doctorName.trim()) return c.json({ error: "Enter the doctor’s name." }, 400); set.doctorName = b.doctorName.trim(); }
  for (const k of ["qualification", "phone", "address", "email", "website", "upiId"] as const) if (b[k] !== undefined) set[k] = txt(b[k]);
  if (b.upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(b.upiId.trim())) return c.json({ error: "The UPI ID should look like name@bank." }, 400);
  if (b.hours) {
    for (const [day, h] of Object.entries(b.hours)) {
      if (h && (!TIME.test(h[0]) || !TIME.test(h[1]) || h[0] >= h[1])) return c.json({ error: `Check the opening hours for ${day}.` }, 400);
    }
    set.hoursJson = JSON.stringify(b.hours);
  }
  if (b.settings) {
    const st = b.settings;
    if (st.services?.some((x) => !x.name?.trim() || !Number.isInteger(x.paise) || x.paise < 0)) return c.json({ error: "Each service needs a name and a price." }, 400);
    if (st.drugs?.some((d) => !d.name?.trim())) return c.json({ error: "Each medicine needs a name." }, 400);
    try { st.drugs?.forEach((d) => directions(d.dose, d.days, d.food)); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
    if (st.labs?.some((l) => !l.name?.trim() || !(l.days > 0))) return c.json({ error: "Each lab needs a name and usual days." }, 400);
    if (st.templates && Object.values(st.templates).some((x) => typeof x !== "string" || !x.trim() || x.length > 1000)) return c.json({ error: "Each message needs some wording (up to 1,000 letters)." }, 400);
    set.settingsJson = JSON.stringify(st);
  }
  if (!Object.keys(set).length) return c.json({ error: "Nothing to save." }, 400);
  await db(c.env).update(s.clinics).set(set).where(eq(s.clinics.id, CLINIC_ID));
  await audit(db(c.env), CLINIC_ID, "update", "clinic", CLINIC_ID, Object.keys(set));
  return c.json({ saved: true });
});

// ---------- Lab orders ----------
type LabStatus = "sent" | "received" | "fitted";
const LAB_STATUSES: LabStatus[] = ["sent", "received", "fitted"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

app.get("/messages/queue", queue);
app.get("/messages", sentLog);
app.post("/messages", logSent);

app.get("/reports", async (c) => {
  const r = await buildReport(c.env, c.req.query("from") ?? "", c.req.query("to") ?? "");
  return typeof r === "string" ? c.json({ error: r }, 400) : c.json(r);
});

app.get("/lab-orders", async (c) => {
  const rows = await db(c.env)
    .select({ o: s.labOrders, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code } })
    .from(s.labOrders).innerJoin(s.patients, eq(s.patients.id, s.labOrders.patientId))
    .where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNull(s.labOrders.deletedAt), isNull(s.patients.deletedAt)))
    .orderBy(desc(s.labOrders.sentOn), desc(s.labOrders.number)).limit(500);
  return c.json(rows.map(({ o, p }) => ({ ...o, patient: p })));
});

app.post("/lab-orders", async (c) => {
  const b = await c.req.json<{ patientId?: string; lab?: string; work?: string; tooth?: string; shade?: string; sentOn?: string; dueOn?: string; billPaise?: number }>();
  const d = db(c.env);
  const [p] = await d.select().from(s.patients)
    .where(and(eq(s.patients.id, b.patientId ?? ""), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!p) return c.json({ error: "Choose a patient." }, 400);
  if (!b.lab?.trim()) return c.json({ error: "Choose the lab." }, 400);
  if (!b.work?.trim()) return c.json({ error: "Say what work is being made." }, 400);
  if (!b.sentOn || !DAY.test(b.sentOn) || !b.dueOn || !DAY.test(b.dueOn)) return c.json({ error: "Enter the sent and due dates." }, 400);
  if (b.dueOn < b.sentOn) return c.json({ error: "The due date is before the sent date." }, 400);
  const billPaise = Math.round(b.billPaise ?? 0);
  if (!(billPaise >= 0)) return c.json({ error: "Check the lab bill." }, 400);
  const id = crypto.randomUUID();
  const number = await nextNumber(c.env, "lab");
  await d.insert(s.labOrders).values({
    id, clinicId: CLINIC_ID, patientId: p.id, number, lab: b.lab.trim(), work: b.work.trim(),
    tooth: b.tooth?.trim() || null, shade: b.shade?.trim() || null, sentOn: b.sentOn, dueOn: b.dueOn, billPaise,
  });
  await audit(d, CLINIC_ID, "create", "lab", id, { number });
  return c.json({ id, number }, 201);
});

app.patch("/lab-orders/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{ status?: LabStatus; billPaise?: number; payPaise?: number; dueOn?: string }>();
  const d = db(c.env);
  const [o] = await d.select().from(s.labOrders)
    .where(and(eq(s.labOrders.id, id), eq(s.labOrders.clinicId, CLINIC_ID), isNull(s.labOrders.deletedAt)));
  if (!o) return c.json({ error: "That lab order was not found." }, 404);
  const set: Partial<typeof s.labOrders.$inferInsert> = {};
  if (b.status !== undefined) { if (!LAB_STATUSES.includes(b.status)) return c.json({ error: "Unknown status." }, 400); set.status = b.status; }
  if (b.billPaise !== undefined) { if (!(b.billPaise >= 0)) return c.json({ error: "Check the lab bill." }, 400); set.billPaise = Math.round(b.billPaise); }
  if (b.dueOn !== undefined) { if (!DAY.test(b.dueOn)) return c.json({ error: "Check the due date." }, 400); set.dueOn = b.dueOn; }
  if (b.payPaise !== undefined) {
    const bill = set.billPaise ?? o.billPaise;
    const pay = Math.round(b.payPaise);
    if (!(pay > 0)) return c.json({ error: "Enter the amount paid to the lab." }, 400);
    if (o.paidPaise + pay > bill) return c.json({ error: `That is more than the ${rupees(bill - o.paidPaise)} still owed.` }, 400);
    set.paidPaise = o.paidPaise + pay;
  }
  if (!Object.keys(set).length) return c.json({ error: "Nothing to change." }, 400);
  await d.update(s.labOrders).set(set).where(eq(s.labOrders.id, id));
  await audit(d, CLINIC_ID, "update", "lab", id, set);
  return c.json({ updated: true });
});

/** Takes the next number in a series (patient, invoice, receipt...) atomically. */
async function nextNumber(env: Env, series: Series): Promise<string> {
  const row = await env.DB.prepare(
    "UPDATE counters SET next = next + 1 WHERE clinic_id = ? AND series = ? RETURNING next - 1 AS n",
  ).bind(CLINIC_ID, series).first<{ n: number }>();
  if (!row) throw new Error(`No counter for ${series}. Run the migrations.`);
  return formatNumber[series](row.n);
}

// ---------- Patients ----------
app.get("/patients", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const like_ = `%${q.replace(/\s+/g, "%")}%`;
  const rows = await db(c.env)
    .select()
    .from(s.patients)
    .where(and(
      eq(s.patients.clinicId, CLINIC_ID),
      isNull(s.patients.deletedAt),
      q ? or(like(s.patients.name, like_), like(s.patients.code, like_), like(s.patients.fileNo, like_), like(s.patients.phone, like_)) : undefined,
    ))
    .orderBy(desc(s.patients.createdAt))
    .limit(200);
  return c.json(rows.map((p) => ({ ...p, alerts: JSON.parse(p.alertsJson) as string[] })));
});

app.post("/patients", async (c) => {
  const body = await c.req.json<{ name?: string; phone?: string; gender?: "F" | "M" | "O"; birthYear?: number; alerts?: string[] }>();
  const name = body.name?.trim();
  const phone = (body.phone ?? "").replace(/\D/g, "").slice(-10);
  if (!name) return c.json({ error: "Enter the patient’s name." }, 400);
  if (phone.length !== 10) return c.json({ error: "Mobile number needs 10 digits." }, 400);
  const id = crypto.randomUUID();
  const code = await nextNumber(c.env, "patient");
  const fileNo = await nextNumber(c.env, "file");
  await db(c.env).insert(s.patients).values({
    id, clinicId: CLINIC_ID, code, fileNo, name, phone,
    gender: body.gender ?? null, birthYear: body.birthYear ?? null,
    alertsJson: JSON.stringify(body.alerts ?? []),
  });
  await audit(db(c.env), CLINIC_ID, "create", "patient", id);
  return c.json({ id, code, fileNo }, 201);
});

// ---------- Patient record ----------
const parsePatient = (p: typeof s.patients.$inferSelect) => ({ ...p, alerts: JSON.parse(p.alertsJson) as string[] });

app.get("/patients/:id", async (c) => {
  const d = db(c.env);
  const id = c.req.param("id");
  const [p] = await d.select().from(s.patients)
    .where(and(eq(s.patients.id, id), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!p) return c.json({ error: "That patient was not found." }, 404);
  const visits = await d.select().from(s.visits)
    .where(and(eq(s.visits.patientId, id), isNull(s.visits.deletedAt))).orderBy(desc(s.visits.createdAt));
  const appts = await d.select().from(s.appointments)
    .where(and(eq(s.appointments.patientId, id), isNull(s.appointments.deletedAt))).orderBy(desc(s.appointments.startsAt)).limit(50);
  return c.json({
    patient: parsePatient(p),
    visits: visits.map(visitOut),
    appointments: appts,
  });
});

// ---------- Visits and prescriptions ----------
type VisitIn = {
  vitals?: Record<string, string>; tooth?: string; complaint?: string; findings?: string[]; diagnosis?: string[];
  notes?: string; advice?: string[]; adviceNote?: string; nextVisit?: string;
  items?: { drug: string; generic?: string | null; dose: string; days: number | null; food: Food }[];
};

function visitOut(v: typeof s.visits.$inferSelect) {
  return {
    id: v.id, patientId: v.patientId, appointmentId: v.appointmentId, createdAt: v.createdAt, signedAt: v.signedAt,
    vitals: JSON.parse(v.vitalsJson) as Record<string, string>, tooth: v.tooth, complaint: v.complaint,
    findings: JSON.parse(v.findingsJson) as string[], diagnosis: JSON.parse(v.diagnosisJson) as string[],
    notes: v.notes, advice: JSON.parse(v.adviceJson) as string[], adviceNote: v.adviceNote, nextVisit: v.nextVisit,
  };
}

async function loadVisit(env: Env, id: string) {
  const d = db(env);
  const [v] = await d.select().from(s.visits)
    .where(and(eq(s.visits.id, id), eq(s.visits.clinicId, CLINIC_ID), isNull(s.visits.deletedAt)));
  if (!v) return null;
  const [p] = await d.select().from(s.patients).where(eq(s.patients.id, v.patientId));
  const items = await d.select().from(s.prescriptionItems)
    .where(eq(s.prescriptionItems.visitId, id)).orderBy(asc(s.prescriptionItems.sortOrder));
  return { visit: visitOut(v), patient: parsePatient(p!), items };
}

/** Starts a visit note for a patient, or reopens today's unsigned one for the same appointment. */
app.post("/visits", async (c) => {
  const b = await c.req.json<{ patientId?: string; appointmentId?: string }>();
  const d = db(c.env);
  const [p] = await d.select().from(s.patients)
    .where(and(eq(s.patients.id, b.patientId ?? ""), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!p) return c.json({ error: "That patient was not found." }, 404);
  if (b.appointmentId) {
    const [open] = await d.select({ id: s.visits.id }).from(s.visits)
      .where(and(eq(s.visits.appointmentId, b.appointmentId), isNull(s.visits.deletedAt)));
    if (open) return c.json({ id: open.id });
  }
  let complaint: string | null = null;
  if (b.appointmentId) {
    const [a] = await d.select().from(s.appointments).where(eq(s.appointments.id, b.appointmentId));
    complaint = a?.notes ?? null;
  }
  const id = crypto.randomUUID();
  await d.insert(s.visits).values({ id, clinicId: CLINIC_ID, patientId: p.id, appointmentId: b.appointmentId ?? null, complaint });
  await audit(d, CLINIC_ID, "create", "visit", id, { patient: p.code });
  return c.json({ id }, 201);
});

app.get("/visits/:id", async (c) => {
  const v = await loadVisit(c.env, c.req.param("id"));
  return v ? c.json(v) : c.json({ error: "That visit was not found." }, 404);
});

/** Saves the draft. Prescription lines are replaced as a whole, with directions written from the dose. */
app.put("/visits/:id", async (c) => {
  const id = c.req.param("id");
  const cur = await loadVisit(c.env, id);
  if (!cur) return c.json({ error: "That visit was not found." }, 404);
  if (cur.visit.signedAt) return c.json({ error: "This note is signed and locked." }, 409);
  const b = await c.req.json<VisitIn>();
  const items = b.items ?? [];
  let lines: (typeof s.prescriptionItems.$inferInsert)[];
  try {
    lines = items.filter((i) => i.drug.trim()).map((i, n) => ({
      id: crypto.randomUUID(), visitId: id, drug: i.drug.trim(), generic: i.generic ?? null,
      dose: i.dose.trim().toUpperCase(), days: i.days, food: i.food,
      instruction: directions(i.dose, i.days, i.food), quantity: quantity(i.dose, i.days), sortOrder: n,
    }));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const d = db(c.env);
  const clean = (x?: string) => x?.trim() || null;
  await d.batch([
    d.update(s.visits).set({
      vitalsJson: JSON.stringify(b.vitals ?? {}), tooth: clean(b.tooth), complaint: clean(b.complaint),
      findingsJson: JSON.stringify(b.findings ?? []), diagnosisJson: JSON.stringify(b.diagnosis ?? []),
      notes: clean(b.notes), adviceJson: JSON.stringify(b.advice ?? []), adviceNote: clean(b.adviceNote), nextVisit: clean(b.nextVisit),
    }).where(eq(s.visits.id, id)),
    d.delete(s.prescriptionItems).where(eq(s.prescriptionItems.visitId, id)),
    ...(lines.length ? [d.insert(s.prescriptionItems).values(lines)] : []),
  ]);
  return c.json({ saved: true, savedAt: new Date().toISOString() });
});

/** Signing locks the note. Checks the same things the screen warns about. */
app.post("/visits/:id/sign", async (c) => {
  const id = c.req.param("id");
  const cur = await loadVisit(c.env, id);
  if (!cur) return c.json({ error: "That visit was not found." }, 404);
  if (cur.visit.signedAt) return c.json({ signedAt: cur.visit.signedAt });
  const { alerts } = cur.patient;
  if (alerts.includes("Diabetic") && !cur.visit.vitals.sugar?.trim()) return c.json({ error: "Add today’s blood sugar before signing (diabetic patient)." }, 400);
  const b = await c.req.json<{ allergyOverride?: boolean }>().catch(() => ({} as { allergyOverride?: boolean }));
  const drugs = (await clinicSettings(c.env)).drugs;
  const clash = penicillinAllergy(alerts) && cur.items.find((i) => findDrug(i.drug, drugs)?.penicillin);
  if (clash && !b.allergyOverride) return c.json({ error: `Penicillin allergy recorded, and ${clash.drug} is a penicillin.` }, 400);
  const signedAt = new Date().toISOString();
  await db(c.env).update(s.visits).set({ signedAt }).where(eq(s.visits.id, id));
  await audit(db(c.env), CLINIC_ID, "sign", "visit", id, clash ? { allergyOverride: clash.drug } : undefined);
  return c.json({ signedAt });
});

// ---------- Billing ----------
type LineIn = { service: string; tooth?: string | null; amountPaise: number };
type PayIn = { amountPaise: number; mode: PayMode; reference?: string | null };
const MODES = PAY_MODES.map((m) => m[0]) as string[];

function checkPay(p: PayIn, balance: number): string | null {
  if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) return "Enter the amount received.";
  if (!MODES.includes(p.mode)) return "Choose how they paid.";
  if (p.amountPaise > balance) return `That is more than the balance of ${rupees(balance)}.`;
  return null;
}

async function invoiceSummaries(env: Env, where?: SQL) {
  const d = db(env);
  const rows = await d.select({ i: s.invoices, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code, phone: s.patients.phone } })
    .from(s.invoices).innerJoin(s.patients, eq(s.patients.id, s.invoices.patientId))
    .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), isNull(s.patients.deletedAt), where))
    .orderBy(desc(s.invoices.issuedAt)).limit(300);
  const paid = await d.select({ invoiceId: s.receipts.invoiceId, sum: sql<number>`sum(${s.receipts.amountPaise})` })
    .from(s.receipts).where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt))).groupBy(s.receipts.invoiceId);
  const paidBy = new Map(paid.map((r) => [r.invoiceId, Number(r.sum)]));
  return rows.map(({ i, p }) => {
    const paidPaise = paidBy.get(i.id) ?? 0;
    return { id: i.id, number: i.number, issuedAt: i.issuedAt, totalPaise: i.totalPaise, discountPaise: i.discountPaise, paidPaise, balancePaise: i.totalPaise - paidPaise, patient: p };
  });
}

app.get("/invoices", async (c) => {
  const patientId = c.req.query("patientId");
  return c.json(await invoiceSummaries(c.env, patientId ? eq(s.invoices.patientId, patientId) : undefined));
});

app.get("/invoices/:id", async (c) => {
  const d = db(c.env);
  const id = c.req.param("id");
  const [sum] = await invoiceSummaries(c.env, eq(s.invoices.id, id));
  if (!sum) return c.json({ error: "That bill was not found." }, 404);
  const lines = await d.select().from(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, id));
  const receipts = await d.select().from(s.receipts)
    .where(and(eq(s.receipts.invoiceId, id), isNull(s.receipts.deletedAt))).orderBy(asc(s.receipts.receivedAt));
  return c.json({ ...sum, lines, receipts });
});

/** New bill, optionally with the payment taken at the counter. */
app.post("/invoices", async (c) => {
  const b = await c.req.json<{ patientId?: string; lines?: LineIn[]; discountPaise?: number; payment?: PayIn | null }>();
  const d = db(c.env);
  const [p] = await d.select().from(s.patients)
    .where(and(eq(s.patients.id, b.patientId ?? ""), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!p) return c.json({ error: "Choose a patient." }, 400);
  const lines = (b.lines ?? []).filter((l) => l.service?.trim());
  if (!lines.length) return c.json({ error: "Add at least one service." }, 400);
  if (lines.some((l) => !Number.isInteger(l.amountPaise) || l.amountPaise < 0)) return c.json({ error: "Check the amounts." }, 400);
  const discountPaise = Math.max(0, Math.round(b.discountPaise ?? 0));
  const totalPaise = billTotal(lines, discountPaise);
  if (b.payment) {
    const bad = checkPay(b.payment, totalPaise);
    if (bad) return c.json({ error: bad }, 400);
  }
  const id = crypto.randomUUID();
  const number = await nextNumber(c.env, "invoice");
  const now = new Date().toISOString();
  const ops: BatchItem<"sqlite">[] = [
    d.insert(s.invoices).values({ id, clinicId: CLINIC_ID, patientId: p.id, number, issuedAt: now, discountPaise, totalPaise }),
    d.insert(s.invoiceLines).values(lines.map((l) => ({ id: crypto.randomUUID(), invoiceId: id, service: l.service.trim(), tooth: l.tooth?.trim() || null, amountPaise: l.amountPaise }))),
  ];
  let receipt: { id: string; number: string } | null = null;
  if (b.payment) {
    receipt = { id: crypto.randomUUID(), number: await nextNumber(c.env, "receipt") };
    ops.push(d.insert(s.receipts).values({
      id: receipt.id, clinicId: CLINIC_ID, patientId: p.id, invoiceId: id, number: receipt.number,
      amountPaise: b.payment.amountPaise, mode: b.payment.mode, reference: b.payment.reference?.trim() || null, receivedAt: now,
    }));
  }
  await d.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  await audit(d, CLINIC_ID, "create", "invoice", id, { number, totalPaise, receipt: receipt?.number });
  return c.json({ id, number, receipt }, 201);
});

/** A later payment against a bill (balance, EMI instalment, insurance settlement). */
app.post("/invoices/:id/receipts", async (c) => {
  const id = c.req.param("id");
  const [sum] = await invoiceSummaries(c.env, eq(s.invoices.id, id));
  if (!sum) return c.json({ error: "That bill was not found." }, 404);
  const b = await c.req.json<PayIn>();
  const bad = checkPay(b, sum.balancePaise);
  if (bad) return c.json({ error: bad }, 400);
  const rid = crypto.randomUUID();
  const number = await nextNumber(c.env, "receipt");
  await db(c.env).insert(s.receipts).values({
    id: rid, clinicId: CLINIC_ID, patientId: sum.patient.id, invoiceId: id, number,
    amountPaise: b.amountPaise, mode: b.mode, reference: b.reference?.trim() || null, receivedAt: new Date().toISOString(),
  });
  await audit(db(c.env), CLINIC_ID, "create", "receipt", rid, { number, amountPaise: b.amountPaise });
  return c.json({ id: rid, number }, 201);
});

/** Everything the A4 receipt needs. */
app.get("/receipts/:id", async (c) => {
  const d = db(c.env);
  const [r] = await d.select().from(s.receipts)
    .where(and(eq(s.receipts.id, c.req.param("id")), eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt)));
  if (!r) return c.json({ error: "That receipt was not found." }, 404);
  const [p] = await d.select().from(s.patients).where(eq(s.patients.id, r.patientId));
  let invoice = null;
  if (r.invoiceId) {
    const [sum] = await invoiceSummaries(c.env, eq(s.invoices.id, r.invoiceId));
    const lines = await d.select().from(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, r.invoiceId));
    const receipts = await d.select().from(s.receipts)
      .where(and(eq(s.receipts.invoiceId, r.invoiceId), isNull(s.receipts.deletedAt))).orderBy(asc(s.receipts.receivedAt));
    invoice = sum ? { ...sum, lines, receipts } : null;
  }
  return c.json({ receipt: r, patient: parsePatient(p!), invoice, inWords: amountInWords(r.amountPaise) });
});

// ---------- Appointments ----------
const STATUSES = ["booked", "arrived", "in_chair", "done", "no_show", "cancelled"] as const;
type Status = (typeof STATUSES)[number];
/** Statuses that hold the chair. A cancelled or no-show slot is free to rebook. */
const HOLDS = (st: Status) => st !== "cancelled" && st !== "no_show";

async function apptRows(env: Env, from: string, to: string) {
  const rows = await db(env)
    .select({ a: s.appointments, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code, phone: s.patients.phone, alertsJson: s.patients.alertsJson } })
    .from(s.appointments)
    .innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
    .where(and(
      eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), isNull(s.patients.deletedAt),
      gte(s.appointments.startsAt, from), lt(s.appointments.startsAt, to),
    ))
    .orderBy(asc(s.appointments.startsAt));
  return rows.map(({ a, p }) => ({
    ...a,
    patient: { id: p.id, name: p.name, code: p.code, phone: p.phone, alerts: JSON.parse(p.alertsJson) as string[] },
  }));
}

/** The first booking that would share the chair with this one, if any. */
async function clash(env: Env, startsAt: string, minutes: number, ignoreId?: string) {
  const dayBefore = new Date(new Date(startsAt).getTime() - 86_400_000).toISOString();
  const dayAfter = new Date(new Date(startsAt).getTime() + 86_400_000).toISOString();
  return (await apptRows(env, dayBefore, dayAfter)).find(
    (a) => a.id !== ignoreId && HOLDS(a.status) && overlaps(a.startsAt, a.minutes, startsAt, minutes),
  );
}

app.get("/appointments", async (c) => {
  const from = c.req.query("from"), to = c.req.query("to");
  if (!from || !to) return c.json({ error: "Give a from and to date." }, 400);
  return c.json(await apptRows(c.env, istToUtc(from, "00:00"), istToUtc(to, "00:00")));
});

app.post("/appointments", async (c) => {
  const b = await c.req.json<{ patientId?: string; day?: string; time?: string; minutes?: number; visitType?: string; notes?: string; squeezedIn?: boolean }>();
  if (!b.patientId) return c.json({ error: "Choose a patient." }, 400);
  if (!b.day || !/^\d{4}-\d{2}-\d{2}$/.test(b.day) || !b.time || !/^\d{2}:\d{2}$/.test(b.time)) return c.json({ error: "Choose a day and time." }, 400);
  const minutes = Math.round(b.minutes ?? 30);
  if (minutes < 5 || minutes > 240) return c.json({ error: "Length must be between 5 minutes and 4 hours." }, 400);
  const visitType = b.visitType?.trim() || "Consultation";
  const [patient] = await db(c.env).select().from(s.patients)
    .where(and(eq(s.patients.id, b.patientId), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  if (!patient) return c.json({ error: "That patient was not found." }, 404);
  const startsAt = istToUtc(b.day, b.time);
  const taken = await clash(c.env, startsAt, minutes);
  if (taken && !b.squeezedIn) {
    const at = utcToIst(taken.startsAt).time;
    return c.json({ error: `${taken.patient.name} is already booked at ${label12(at)}.`, clash: true }, 409);
  }
  const id = crypto.randomUUID();
  await db(c.env).insert(s.appointments).values({
    id, clinicId: CLINIC_ID, patientId: patient.id, startsAt, minutes, visitType,
    notes: b.notes?.trim() || null, squeezedIn: !!taken,
  });
  await audit(db(c.env), CLINIC_ID, "create", "appointment", id, { patient: patient.code, startsAt });
  return c.json({ id, squeezedIn: !!taken }, 201);
});

app.patch("/appointments/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{ status?: Status; day?: string; time?: string; minutes?: number; visitType?: string; notes?: string; squeezedIn?: boolean }>();
  const [cur] = await db(c.env).select().from(s.appointments)
    .where(and(eq(s.appointments.id, id), eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt)));
  if (!cur) return c.json({ error: "That appointment was not found." }, 404);
  const set: Partial<typeof s.appointments.$inferInsert> = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return c.json({ error: "Unknown status." }, 400);
    set.status = b.status;
  }
  if (b.visitType !== undefined) set.visitType = b.visitType.trim() || cur.visitType;
  if (b.notes !== undefined) set.notes = b.notes.trim() || null;
  if (b.minutes !== undefined) set.minutes = Math.round(b.minutes);
  if (b.day && b.time) set.startsAt = istToUtc(b.day, b.time);
  if (set.startsAt || set.minutes) {
    const taken = await clash(c.env, set.startsAt ?? cur.startsAt, set.minutes ?? cur.minutes, id);
    if (taken && !b.squeezedIn) return c.json({ error: `${taken.patient.name} is already booked then.`, clash: true }, 409);
    set.squeezedIn = !!taken;
  }
  if (!Object.keys(set).length) return c.json({ error: "Nothing to change." }, 400);
  await db(c.env).update(s.appointments).set(set).where(eq(s.appointments.id, id));
  await audit(db(c.env), CLINIC_ID, "update", "appointment", id, set);
  return c.json({ updated: true });
});

// ---------- Delete, undo, Recently deleted ----------
const COLLECTIONS: Record<string, TrashKind> = {
  patients: "patient", appointments: "appointment", visits: "visit", invoices: "invoice",
  receipts: "receipt", "lab-orders": "lab", files: "file",
};

/** Delete = move to Recently deleted. The app shows an Undo bar, which calls restore. */
app.delete("/:collection/:id", async (c) => {
  const kind = COLLECTIONS[c.req.param("collection")];
  if (!kind) return c.json({ error: "Not found." }, 404);
  const reason = c.req.query("reason") ?? null;
  const ok = await softDelete(db(c.env), CLINIC_ID, kind, c.req.param("id"), reason);
  return ok ? c.json({ deleted: true, removedOn: removalDate(new Date().toISOString()).toISOString() }) : c.json({ error: "Not found." }, 404);
});

app.get("/trash", async (c) => {
  const d = db(c.env);
  const items: { kind: TrashKind; id: string; title: string; detail: string; deletedAt: string; reason: string | null; daysLeft: number }[] = [];
  const push = (kind: TrashKind, id: string, title: string, detail: string, deletedAt: string | null, reason: string | null) => {
    if (deletedAt) items.push({ kind, id, title, detail, deletedAt, reason, daysLeft: daysLeft(deletedAt) });
  };
  for (const p of await d.select().from(s.patients).where(and(eq(s.patients.clinicId, CLINIC_ID), isNotNull(s.patients.deletedAt))))
    push("patient", p.id, p.name, `${p.code}${p.fileNo ? " · " + p.fileNo : ""}`, p.deletedAt, p.deletedReason);
  for (const r of await d.select().from(s.receipts).where(and(eq(s.receipts.clinicId, CLINIC_ID), isNotNull(s.receipts.deletedAt))))
    push("receipt", r.id, `Receipt ${r.number}`, `${r.mode.toUpperCase()} · ${rupees(r.amountPaise)}`, r.deletedAt, r.deletedReason);
  for (const r of await d.select().from(s.invoices).where(and(eq(s.invoices.clinicId, CLINIC_ID), isNotNull(s.invoices.deletedAt))))
    push("invoice", r.id, `Invoice ${r.number}`, rupees(r.totalPaise), r.deletedAt, r.deletedReason);
  for (const r of await d.select().from(s.labOrders).where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNotNull(s.labOrders.deletedAt))))
    push("lab", r.id, `Lab order ${r.number} · ${r.work}`, r.lab, r.deletedAt, r.deletedReason);
  for (const { a, name } of await d.select({ a: s.appointments, name: s.patients.name }).from(s.appointments)
    .innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
    .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNotNull(s.appointments.deletedAt)))) {
    const { day, time } = utcToIst(a.startsAt);
    push("appointment", a.id, `Appointment · ${name}`, `${a.visitType} · ${day} ${label12(time)}`, a.deletedAt, a.deletedReason);
  }
  for (const { v, name } of await d.select({ v: s.visits, name: s.patients.name }).from(s.visits)
    .innerJoin(s.patients, eq(s.patients.id, s.visits.patientId))
    .where(and(eq(s.visits.clinicId, CLINIC_ID), isNotNull(s.visits.deletedAt))))
    push("visit", v.id, `Visit note · ${name}`, utcToIst(v.createdAt).day, v.deletedAt, v.deletedReason);
  for (const r of await d.select().from(s.files).where(and(eq(s.files.clinicId, CLINIC_ID), isNotNull(s.files.deletedAt))))
    push("file", r.id, r.filename, r.kind, r.deletedAt, r.deletedReason);
  items.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt));
  return c.json(items);
});

app.post("/trash/:kind/:id/restore", async (c) => {
  const kind = c.req.param("kind");
  if (!isTrashKind(kind)) return c.json({ error: "Unknown item type." }, 400);
  const ok = await restore(db(c.env), CLINIC_ID, kind, c.req.param("id"));
  return ok ? c.json({ restored: true }) : c.json({ error: "Not in Recently deleted." }, 404);
});

app.delete("/trash/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (!isTrashKind(kind)) return c.json({ error: "Unknown item type." }, 400);
  const ok = await purgeOne(db(c.env), c.env, CLINIC_ID, kind, c.req.param("id"));
  return ok ? c.json({ purged: true }) : c.json({ error: "Not in Recently deleted." }, 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpired(db(env), env).then((n) => console.log(`Purged ${n} item(s) older than 30 days.`)));
  },
} satisfies ExportedHandler<Env>;

