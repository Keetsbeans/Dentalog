import { and, desc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { addDays, istToUtc, todayIst, weekday, toMinutes, type Hours } from "../shared/time";
import { rupees } from "../shared/money";
import { readSettings } from "../shared/settings";
import { PLANS, sittings, type PlanName } from "../shared/teeth";

type C = Context<{ Bindings: Env }>;
export type Attention = { key: string; tone: "red" | "amber" | "blue"; title: string; detail: string; href: string };
export type TodayData = {
  collectedPaise: number; collectedFrom: number; modes: string[];
  toBill: { patientId: string; name: string; what: string; paise: number | null }[];
  outstandingPaise: number; owingPatients: number;
  attention: Attention[];
  week: { day: string; visits: number; bookedMin: number; openMin: number }[];
};

const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", insurance: "Insurance", emi: "EMI" };
const names = (xs: string[], max = 3) => xs.slice(0, max).join(", ") + (xs.length > max ? ` and ${xs.length - max} more` : "");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Everything the home page needs beyond the appointment list. */
export async function today(c: C) {
  const d = drizzle(c.env.DB, { schema: s });
  const day = todayIst();
  const start = istToUtc(day, "00:00"), end = istToUtc(addDays(day, 1), "00:00");
  const nowIso = new Date().toISOString();
  const [clinic] = await d.select().from(s.clinics).where(eq(s.clinics.id, CLINIC_ID));
  const settings = readSettings(clinic?.settingsJson);
  let hours: Hours = {} as Hours;
  try { hours = JSON.parse(clinic?.hoursJson ?? "{}") as Hours; } catch { /* closed */ }

  const pName = { id: s.patients.id, name: s.patients.name };
  const [receipts, apptsToday, invToday, teeth, invoices, paid, labs, upcoming, drafts, lastVisits, weekAppts, sentReminders] = await Promise.all([
    d.select({ amount: s.receipts.amountPaise, mode: s.receipts.mode, patientId: s.receipts.patientId }).from(s.receipts)
      .where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt), gte(s.receipts.receivedAt, start), lt(s.receipts.receivedAt, end))),
    d.select({ a: s.appointments, p: pName }).from(s.appointments).innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), isNull(s.patients.deletedAt), gte(s.appointments.startsAt, start), lt(s.appointments.startsAt, end))),
    d.select({ patientId: s.invoices.patientId }).from(s.invoices)
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), gte(s.invoices.issuedAt, start), lt(s.invoices.issuedAt, end))),
    d.select({ t: s.teeth, p: pName }).from(s.teeth).innerJoin(s.patients, eq(s.patients.id, s.teeth.patientId))
      .where(and(eq(s.teeth.clinicId, CLINIC_ID), isNotNull(s.teeth.plan), isNull(s.patients.deletedAt))),
    d.select({ id: s.invoices.id, total: s.invoices.totalPaise, issuedAt: s.invoices.issuedAt, p: pName }).from(s.invoices).innerJoin(s.patients, eq(s.patients.id, s.invoices.patientId))
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), isNull(s.patients.deletedAt))),
    d.select({ invoiceId: s.receipts.invoiceId, amount: s.receipts.amountPaise }).from(s.receipts)
      .where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt))),
    d.select({ o: s.labOrders, p: pName }).from(s.labOrders).innerJoin(s.patients, eq(s.patients.id, s.labOrders.patientId))
      .where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNull(s.labOrders.deletedAt), isNull(s.patients.deletedAt), inArray(s.labOrders.status, ["sent", "received"]))),
    d.select({ patientId: s.appointments.patientId, startsAt: s.appointments.startsAt }).from(s.appointments)
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), inArray(s.appointments.status, ["booked", "arrived", "in_chair"]), gte(s.appointments.startsAt, nowIso))),
    d.select({ id: s.visits.id, createdAt: s.visits.createdAt, p: pName }).from(s.visits).innerJoin(s.patients, eq(s.patients.id, s.visits.patientId))
      .where(and(eq(s.visits.clinicId, CLINIC_ID), isNull(s.visits.deletedAt), isNull(s.patients.deletedAt), isNull(s.visits.signedAt), lt(s.visits.createdAt, start))),
    d.select({ patientId: s.visits.patientId, signedAt: s.visits.signedAt }).from(s.visits)
      .where(and(eq(s.visits.clinicId, CLINIC_ID), isNull(s.visits.deletedAt), isNotNull(s.visits.signedAt))).orderBy(desc(s.visits.signedAt)),
    d.select({ startsAt: s.appointments.startsAt, minutes: s.appointments.minutes, status: s.appointments.status, id: s.appointments.id }).from(s.appointments)
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), gte(s.appointments.startsAt, start), lt(s.appointments.startsAt, istToUtc(addDays(day, 7), "00:00")))),
    d.select({ refId: s.messages.refId }).from(s.messages).where(and(eq(s.messages.clinicId, CLINIC_ID), eq(s.messages.kind, "reminder"))),
  ]);

  // Collected today
  const collectedPaise = receipts.reduce((a, r) => a + r.amount, 0);
  const collectedFrom = new Set(receipts.map((r) => r.patientId)).size;
  const modes = [...new Set(receipts.map((r) => MODE[r.mode] ?? r.mode))];

  // Waiting to be billed: finished treatments not billed, and people seen today with no bill today
  const priceOf = (p: PlanName) => settings.services.find((x) => x.name.toLowerCase() === PLANS[p].service.toLowerCase())?.paise ?? null;
  const toBill: TodayData["toBill"] = [];
  for (const { t, p } of teeth) {
    const plan = t.plan as PlanName;
    if (!(plan in PLANS) || t.billed || t.done < sittings({ tooth: t.tooth, condition: "Healthy", plan, done: t.done, billed: t.billed })) continue;
    toBill.push({ patientId: p.id, name: p.name, what: `${PLANS[plan].label} · tooth ${t.tooth}`, paise: priceOf(plan) });
  }
  const billedToday = new Set(invToday.map((i) => i.patientId));
  for (const { a, p } of apptsToday) {
    if (a.status === "done" && !billedToday.has(p.id) && !toBill.some((x) => x.patientId === p.id)) toBill.push({ patientId: p.id, name: p.name, what: `Seen today · ${a.visitType}`, paise: null });
  }

  // Still to collect
  const paidBy = new Map<string, number>();
  for (const r of paid) if (r.invoiceId) paidBy.set(r.invoiceId, (paidBy.get(r.invoiceId) ?? 0) + r.amount);
  let outstandingPaise = 0;
  const owing = new Map<string, { name: string; paise: number; oldest: string }>();
  for (const i of invoices) {
    const bal = i.total - (paidBy.get(i.id) ?? 0);
    if (bal <= 0) continue;
    outstandingPaise += bal;
    const o = owing.get(i.p.id) ?? { name: i.p.name, paise: 0, oldest: i.issuedAt };
    o.paise += bal; if (i.issuedAt < o.oldest) o.oldest = i.issuedAt;
    owing.set(i.p.id, o);
  }

  // Needs attention
  const attention: Attention[] = [];
  const late = labs.filter(({ o }) => o.status === "sent" && o.dueOn <= day);
  if (late.length) attention.push({ key: "lab-late", tone: "red", title: `${late.length} lab ${late.length === 1 ? "order" : "orders"} due back and not received`, detail: names(late.map(({ o, p }) => `${o.work} for ${p.name}`)), href: "/lab-orders" });
  const back = labs.filter(({ o }) => o.status === "received");
  if (back.length) attention.push({ key: "lab-back", tone: "blue", title: `${back.length} lab ${back.length === 1 ? "job is" : "jobs are"} back, waiting to be fitted`, detail: names(back.map(({ o, p }) => `${p.name} (${o.work})`)), href: "/lab-orders" });
  const booked = new Set(upcoming.map((u) => u.patientId));
  const noNext = teeth.filter(({ t }) => t.plan && t.plan in PLANS && t.done > 0 && t.done < PLANS[t.plan as PlanName].steps.length && !booked.has(t.patientId));
  const noNextNames = [...new Set(noNext.map(({ p }) => p.name))];
  if (noNextNames.length) attention.push({ key: "no-next", tone: "amber", title: `${noNextNames.length} ${noNextNames.length === 1 ? "patient" : "patients"} mid-treatment with no next sitting booked`, detail: names(noNextNames), href: "/patients" });
  const old = [...owing.values()].filter((o) => o.oldest < ago(30));
  if (old.length) attention.push({ key: "owing", tone: "amber", title: `${old.length} ${old.length === 1 ? "balance" : "balances"} unpaid for 30+ days`, detail: `${rupees(old.reduce((a, o) => a + o.paise, 0))} · ${names(old.map((o) => o.name))}`, href: "/billing" });
  if (drafts.length) attention.push({ key: "drafts", tone: "amber", title: `${drafts.length} visit ${drafts.length === 1 ? "note" : "notes"} from earlier days not signed`, detail: names(drafts.map(({ p }) => p.name)), href: `/visits/${drafts[0]!.id}` });
  const tomorrow = addDays(day, 1);
  const tStart = istToUtc(tomorrow, "00:00"), tEnd = istToUtc(addDays(tomorrow, 1), "00:00");
  const sent = new Set(sentReminders.map((m) => m.refId));
  const unsent = weekAppts.filter((a) => a.status === "booked" && a.startsAt >= tStart && a.startsAt < tEnd && !sent.has(a.id));
  if (unsent.length) attention.push({ key: "reminders", tone: "blue", title: `${unsent.length} WhatsApp ${unsent.length === 1 ? "reminder" : "reminders"} for tomorrow not sent yet`, detail: "Send them from Messages", href: "/messages" });
  const latest = new Map<string, string>();
  for (const v of lastVisits) if (v.signedAt && !latest.has(v.patientId)) latest.set(v.patientId, v.signedAt);
  const recalls = [...latest].filter(([pid, at]) => at <= ago(182) && at >= ago(548) && !booked.has(pid)).length;
  if (recalls) attention.push({ key: "recalls", tone: "blue", title: `${recalls} ${recalls === 1 ? "patient is" : "patients are"} due for a 6-month check-up`, detail: "Send recalls from Messages", href: "/messages" });

  // Rest of the week
  const week: TodayData["week"] = [];
  for (let i = 0; i < 7; i++) {
    const dd = addDays(day, i);
    const h = hours[weekday(dd)];
    const ds = istToUtc(dd, "00:00"), de = istToUtc(addDays(dd, 1), "00:00");
    const list = weekAppts.filter((a) => a.startsAt >= ds && a.startsAt < de && a.status !== "cancelled");
    week.push({ day: dd, visits: list.length, bookedMin: list.reduce((a, x) => a + x.minutes, 0), openMin: h ? toMinutes(h[1]) - toMinutes(h[0]) : 0 });
  }

  return c.json({ collectedPaise, collectedFrom, modes, toBill, outstandingPaise, owingPatients: owing.size, attention, week } satisfies TodayData);
}
