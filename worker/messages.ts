import { and, desc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { addDays, istToUtc, label12, todayIst, utcToIst } from "../shared/time";
import { rupees } from "../shared/money";
import type { MessageKind } from "../shared/messages";

type C = Context<{ Bindings: Env }>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: MessageKind[] = ["reminder", "recall", "balance", "lab_ready"];

export type QueuePatient = { id: string; name: string; code: string; phone: string; consent: boolean };
export type QueueItem = {
  kind: MessageKind; refId: string; patient: QueuePatient;
  vars: Record<string, string>; detail: string; sentAt: string | null;
};

const fmt = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { ...o, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * Who should get a WhatsApp message: tomorrow's (or a chosen day's) appointments,
 * check-up recalls, unpaid balances and lab work that has come back.
 */
export async function queue(c: C) {
  const d = drizzle(c.env.DB, { schema: s });
  const today = todayIst();
  const day = c.req.query("day") ?? addDays(today, 1);
  if (!DAY.test(day)) return c.json({ error: "Give the day as YYYY-MM-DD." }, 400);
  const pCols = { id: s.patients.id, name: s.patients.name, code: s.patients.code, phone: s.patients.phone, consent: s.patients.whatsappConsent };
  const nowIso = new Date().toISOString();

  const [appts, labs, lastVisits, upcoming, invoices, paid, sent] = await Promise.all([
    d.select({ a: s.appointments, p: pCols }).from(s.appointments).innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), isNull(s.patients.deletedAt), eq(s.appointments.status, "booked"),
        gte(s.appointments.startsAt, istToUtc(day, "00:00")), lt(s.appointments.startsAt, istToUtc(addDays(day, 1), "00:00"))))
      .orderBy(s.appointments.startsAt),
    d.select({ o: s.labOrders, p: pCols }).from(s.labOrders).innerJoin(s.patients, eq(s.patients.id, s.labOrders.patientId))
      .where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNull(s.labOrders.deletedAt), isNull(s.patients.deletedAt), eq(s.labOrders.status, "received"))),
    d.select({ patientId: s.visits.patientId, signedAt: s.visits.signedAt, p: pCols }).from(s.visits).innerJoin(s.patients, eq(s.patients.id, s.visits.patientId))
      .where(and(eq(s.visits.clinicId, CLINIC_ID), isNull(s.visits.deletedAt), isNull(s.patients.deletedAt), isNotNull(s.visits.signedAt))),
    d.select({ patientId: s.appointments.patientId }).from(s.appointments)
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), inArray(s.appointments.status, ["booked", "arrived", "in_chair"]), gte(s.appointments.startsAt, nowIso))),
    d.select({ id: s.invoices.id, total: s.invoices.totalPaise, p: pCols }).from(s.invoices).innerJoin(s.patients, eq(s.patients.id, s.invoices.patientId))
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), isNull(s.patients.deletedAt))),
    d.select({ invoiceId: s.receipts.invoiceId, amount: s.receipts.amountPaise }).from(s.receipts)
      .where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt))),
    d.select({ kind: s.messages.kind, refId: s.messages.refId, at: s.messages.createdAt }).from(s.messages)
      .where(and(eq(s.messages.clinicId, CLINIC_ID), gte(s.messages.createdAt, ago(400)))).orderBy(desc(s.messages.createdAt)),
  ]);

  // Latest send for each kind + item. Recalls and balance nudges count as "sent" only for a while.
  const lastSent = new Map<string, string>();
  for (const m of sent) if (!lastSent.has(`${m.kind}:${m.refId}`)) lastSent.set(`${m.kind}:${m.refId}`, m.at);
  const sentSince = (kind: MessageKind, refId: string, since?: string) => {
    const at = lastSent.get(`${kind}:${refId}`) ?? null;
    return at && (!since || at >= since) ? at : null;
  };

  const items: QueueItem[] = [];
  const dayText = fmt(day, { weekday: "long", day: "numeric", month: "long" });
  for (const { a, p } of appts) {
    const time = label12(utcToIst(a.startsAt).time);
    items.push({ kind: "reminder", refId: a.id, patient: p, vars: { day: dayText, time, visit: a.visitType.toLowerCase() },
      detail: `${time} · ${a.visitType}`, sentAt: sentSince("reminder", a.id) });
  }

  for (const { o, p } of labs) {
    items.push({ kind: "lab_ready", refId: o.id, patient: p, vars: { work: o.work.toLowerCase() },
      detail: `${o.work}${o.tooth ? ` · ${o.tooth}` : ""} · back from ${o.lab}`, sentAt: sentSince("lab_ready", o.id) });
  }

  // Recall: last signed visit 6 to 18 months ago, nothing booked ahead.
  const booked = new Set(upcoming.map((u) => u.patientId));
  const latest = new Map<string, { at: string; p: QueuePatient }>();
  for (const v of lastVisits) {
    const cur = latest.get(v.patientId);
    if (v.signedAt && (!cur || v.signedAt > cur.at)) latest.set(v.patientId, { at: v.signedAt, p: v.p });
  }
  const sixMonths = ago(182), eighteen = ago(548);
  for (const [pid, { at, p }] of latest) {
    if (at > sixMonths || at < eighteen || booked.has(pid)) continue;
    const last = fmt(utcToIst(at).day, { month: "long", year: "numeric" });
    items.push({ kind: "recall", refId: pid, patient: p, vars: { last }, detail: `Last visit ${last}`, sentAt: sentSince("recall", pid, ago(90)) });
  }

  // Balance due, per patient.
  const paidBy = new Map<string, number>();
  for (const r of paid) if (r.invoiceId) paidBy.set(r.invoiceId, (paidBy.get(r.invoiceId) ?? 0) + r.amount);
  const owing = new Map<string, { p: QueuePatient; paise: number; bills: number }>();
  for (const i of invoices) {
    const bal = i.total - (paidBy.get(i.id) ?? 0);
    if (bal <= 0) continue;
    const o = owing.get(i.p.id) ?? { p: i.p, paise: 0, bills: 0 };
    o.paise += bal; o.bills++;
    owing.set(i.p.id, o);
  }
  for (const [pid, o] of owing) {
    items.push({ kind: "balance", refId: pid, patient: o.p, vars: { amount: rupees(o.paise) },
      detail: `${rupees(o.paise)} due on ${o.bills} bill${o.bills === 1 ? "" : "s"}`, sentAt: sentSince("balance", pid, ago(14)) });
  }

  return c.json({ day, today, items });
}

/** Records that a message was opened in WhatsApp to send. */
export async function logSent(c: C) {
  const b = await c.req.json<{ patientId?: string; kind?: MessageKind; refId?: string | null; body?: string }>();
  if (!b.patientId || !b.body?.trim()) return c.json({ error: "Nothing to record." }, 400);
  const kind: MessageKind | "other" = KINDS.includes(b.kind as MessageKind) ? (b.kind as MessageKind) : "other";
  const d = drizzle(c.env.DB, { schema: s });
  const [p] = await d.select({ id: s.patients.id }).from(s.patients).where(and(eq(s.patients.id, b.patientId), eq(s.patients.clinicId, CLINIC_ID)));
  if (!p) return c.json({ error: "That patient was not found." }, 404);
  const row = { id: crypto.randomUUID(), clinicId: CLINIC_ID, patientId: p.id, kind, refId: b.refId ?? null, body: b.body.trim().slice(0, 2000), createdAt: new Date().toISOString() };
  await d.insert(s.messages).values(row);
  return c.json({ id: row.id, createdAt: row.createdAt });
}

/** The most recent messages sent, newest first. */
export async function sentLog(c: C) {
  const d = drizzle(c.env.DB, { schema: s });
  const rows = await d.select({ m: s.messages, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code } })
    .from(s.messages).innerJoin(s.patients, eq(s.patients.id, s.messages.patientId))
    .where(and(eq(s.messages.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)))
    .orderBy(desc(s.messages.createdAt)).limit(200);
  return c.json(rows.map(({ m, p }) => ({ ...m, patient: p })));
}
