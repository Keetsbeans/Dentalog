import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { addDays, istToUtc, utcToIst } from "../shared/time";
import type { Bucket, Report } from "../shared/report";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Money and visits for India-time days from..to (both included). */
export async function buildReport(env: Env, from: string, to: string): Promise<Report | string> {
  if (!DAY.test(from) || !DAY.test(to)) return "Give the dates as YYYY-MM-DD.";
  if (to < from) return "The end date is before the start date.";
  const d = drizzle(env.DB, { schema: s });
  const start = istToUtc(from, "00:00"), end = istToUtc(addDays(to, 1), "00:00");
  const day = (iso: string) => utcToIst(iso).day;

  const [receipts, invoices, lines, labs, visits, patients, appts, allInvoices, allPaid] = await Promise.all([
    d.select({ amount: s.receipts.amountPaise, mode: s.receipts.mode, at: s.receipts.receivedAt }).from(s.receipts)
      .where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt), gte(s.receipts.receivedAt, start), lt(s.receipts.receivedAt, end))),
    d.select({ total: s.invoices.totalPaise }).from(s.invoices)
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), gte(s.invoices.issuedAt, start), lt(s.invoices.issuedAt, end))),
    d.select({ service: s.invoiceLines.service, amount: s.invoiceLines.amountPaise }).from(s.invoiceLines)
      .innerJoin(s.invoices, eq(s.invoices.id, s.invoiceLines.invoiceId))
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), gte(s.invoices.issuedAt, start), lt(s.invoices.issuedAt, end))),
    d.select({ bill: s.labOrders.billPaise }).from(s.labOrders)
      .where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNull(s.labOrders.deletedAt), gte(s.labOrders.sentOn, from), lt(s.labOrders.sentOn, addDays(to, 1)))),
    d.select({ at: s.visits.signedAt }).from(s.visits)
      .where(and(eq(s.visits.clinicId, CLINIC_ID), isNull(s.visits.deletedAt), gte(s.visits.signedAt, start), lt(s.visits.signedAt, end))),
    d.select({ id: s.patients.id }).from(s.patients)
      .where(and(eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt), gte(s.patients.createdAt, start), lt(s.patients.createdAt, end))),
    d.select({ status: s.appointments.status }).from(s.appointments)
      .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), gte(s.appointments.startsAt, start), lt(s.appointments.startsAt, end))),
    d.select({ id: s.invoices.id, total: s.invoices.totalPaise, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code } })
      .from(s.invoices).innerJoin(s.patients, eq(s.patients.id, s.invoices.patientId))
      .where(and(eq(s.invoices.clinicId, CLINIC_ID), isNull(s.invoices.deletedAt), isNull(s.patients.deletedAt))),
    d.select({ invoiceId: s.receipts.invoiceId, amount: s.receipts.amountPaise }).from(s.receipts)
      .where(and(eq(s.receipts.clinicId, CLINIC_ID), isNull(s.receipts.deletedAt))),
  ]);

  // Time buckets: days for up to ~2 months, months beyond that.
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const by: Report["by"] = days > 62 ? "month" : "day";
  const keyOf = (dayStr: string) => (by === "month" ? dayStr.slice(0, 7) : dayStr);
  const buckets = new Map<string, Bucket>();
  for (let k = from; k <= to; k = addDays(k, 1)) {
    if (!buckets.has(keyOf(k))) buckets.set(keyOf(k), { key: keyOf(k), collectedPaise: 0, visits: 0 });
  }

  const modes = new Map<string, { mode: string; paise: number; count: number }>();
  for (const r of receipts) {
    const b = buckets.get(keyOf(day(r.at)));
    if (b) b.collectedPaise += r.amount;
    const m = modes.get(r.mode) ?? { mode: r.mode, paise: 0, count: 0 };
    m.paise += r.amount; m.count++;
    modes.set(r.mode, m);
  }
  for (const v of visits) {
    const b = v.at && buckets.get(keyOf(day(v.at)));
    if (b) b.visits++;
  }

  const services = new Map<string, { service: string; count: number; paise: number }>();
  for (const l of lines) {
    const sv = services.get(l.service) ?? { service: l.service, count: 0, paise: 0 };
    sv.count++; sv.paise += l.amount;
    services.set(l.service, sv);
  }

  const paidBy = new Map<string, number>();
  for (const r of allPaid) if (r.invoiceId) paidBy.set(r.invoiceId, (paidBy.get(r.invoiceId) ?? 0) + r.amount);
  const owingBy = new Map<string, Report["owing"][number]>();
  for (const i of allInvoices) {
    const bal = i.total - (paidBy.get(i.id) ?? 0);
    if (bal <= 0) continue;
    const o = owingBy.get(i.p.id) ?? { ...i.p, balancePaise: 0 };
    o.balancePaise += bal;
    owingBy.set(i.p.id, o);
  }
  const owing = [...owingBy.values()].sort((a, b) => b.balancePaise - a.balancePaise);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    from, to, by,
    collectedPaise: sum(receipts.map((r) => r.amount)),
    billedPaise: sum(invoices.map((i) => i.total)),
    labPaise: sum(labs.map((l) => l.bill)),
    visits: visits.length,
    newPatients: patients.length,
    booked: appts.filter((a) => a.status !== "cancelled").length,
    came: appts.filter((a) => a.status === "arrived" || a.status === "in_chair" || a.status === "done").length,
    noShows: appts.filter((a) => a.status === "no_show").length,
    cancelled: appts.filter((a) => a.status === "cancelled").length,
    outstandingPaise: sum(owing.map((o) => o.balancePaise)),
    owing: owing.slice(0, 10),
    modes: [...modes.values()].sort((a, b) => b.paise - a.paise),
    services: [...services.values()].sort((a, b) => b.paise - a.paise).slice(0, 10),
    series: [...buckets.values()],
  };
}
