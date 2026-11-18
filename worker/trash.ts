import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as s from "./db/schema";
import { purgeBefore } from "../shared/trash";

type Db = DrizzleD1Database<typeof s>;

/** Everything that can be deleted, restored or purged. */
export const TRASHABLE = {
  patient: s.patients,
  appointment: s.appointments,
  visit: s.visits,
  invoice: s.invoices,
  receipt: s.receipts,
  lab: s.labOrders,
  file: s.files,
} as const;
export type TrashKind = keyof typeof TRASHABLE;

export function isTrashKind(k: string): k is TrashKind {
  return k in TRASHABLE;
}

export async function audit(db: Db, clinicId: string, action: string, entity: string, entityId: string, detail?: unknown) {
  await db.insert(s.auditLog).values({
    clinicId, actor: "doctor", action, entity, entityId,
    detail: detail === undefined ? null : JSON.stringify(detail),
  });
}

export async function softDelete(db: Db, clinicId: string, kind: TrashKind, id: string, reason: string | null) {
  const t = TRASHABLE[kind];
  const deletedAt = new Date().toISOString();
  // A bill takes its payments with it, stamped with the same time so Undo brings them back together.
  if (kind === "invoice") {
    await db.update(s.receipts).set({ deletedAt, deletedReason: "Deleted with its invoice" })
      .where(and(eq(s.receipts.invoiceId, id), eq(s.receipts.clinicId, clinicId), isNull(s.receipts.deletedAt)));
  }
  const res = await db
    .update(t)
    .set({ deletedAt, deletedReason: reason })
    .where(and(eq(t.id, id), eq(t.clinicId, clinicId), isNull(t.deletedAt)))
    .returning({ id: t.id });
  if (res.length) await audit(db, clinicId, "delete", kind, id, { reason });
  return res.length > 0;
}

export async function restore(db: Db, clinicId: string, kind: TrashKind, id: string) {
  const t = TRASHABLE[kind];
  if (kind === "invoice") {
    const [inv] = await db.select().from(s.invoices).where(and(eq(s.invoices.id, id), eq(s.invoices.clinicId, clinicId)));
    if (inv?.deletedAt) {
      await db.update(s.receipts).set({ deletedAt: null, deletedReason: null })
        .where(and(eq(s.receipts.invoiceId, id), eq(s.receipts.deletedAt, inv.deletedAt)));
    }
  }
  if (kind === "receipt") {
    // A payment can't come back on its own while its bill is still deleted.
    const [r] = await db.select().from(s.receipts).where(and(eq(s.receipts.id, id), eq(s.receipts.clinicId, clinicId)));
    if (r?.invoiceId) {
      const [inv] = await db.select({ deletedAt: s.invoices.deletedAt }).from(s.invoices).where(eq(s.invoices.id, r.invoiceId));
      if (inv?.deletedAt) return false;
    }
  }
  const res = await db
    .update(t)
    .set({ deletedAt: null, deletedReason: null })
    .where(and(eq(t.id, id), eq(t.clinicId, clinicId), isNotNull(t.deletedAt)))
    .returning({ id: t.id });
  if (res.length) await audit(db, clinicId, "restore", kind, id);
  return res.length > 0;
}

/**
 * Remove for good. Invoices and receipts keep a line in the audit log
 * (number, amount, reason) so the numbering never has an unexplained gap.
 * A patient takes their visits, appointments, bills and files with them.
 */
export async function purgeOne(db: Db, env: { FILES?: R2Bucket }, clinicId: string, kind: TrashKind, id: string) {
  const t = TRASHABLE[kind];
  const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.clinicId, clinicId), isNotNull(t.deletedAt)));
  if (!row) return false;

  if (kind === "patient") {
    const files = await db.select().from(s.files).where(eq(s.files.patientId, id));
    for (const f of files) await env.FILES?.delete(f.r2Key);
    const visitIds = (await db.select({ id: s.visits.id }).from(s.visits).where(eq(s.visits.patientId, id))).map((v) => v.id);
    for (const v of visitIds) await db.delete(s.prescriptionItems).where(eq(s.prescriptionItems.visitId, v));
    await db.delete(s.files).where(eq(s.files.patientId, id));
    await db.delete(s.receipts).where(eq(s.receipts.patientId, id));
    const invoiceIds = (await db.select({ id: s.invoices.id }).from(s.invoices).where(eq(s.invoices.patientId, id))).map((v) => v.id);
    for (const i of invoiceIds) await db.delete(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, i));
    await db.delete(s.invoices).where(eq(s.invoices.patientId, id));
    await db.delete(s.messages).where(eq(s.messages.patientId, id));
    await db.delete(s.teeth).where(eq(s.teeth.patientId, id));
    await db.delete(s.toothEvents).where(eq(s.toothEvents.patientId, id));
    await db.delete(s.labOrders).where(eq(s.labOrders.patientId, id));
    await db.delete(s.visits).where(eq(s.visits.patientId, id));
    await db.delete(s.appointments).where(eq(s.appointments.patientId, id));
  }
  if (kind === "visit") await db.delete(s.prescriptionItems).where(eq(s.prescriptionItems.visitId, id));
  if (kind === "invoice") {
    for (const r of await db.select().from(s.receipts).where(eq(s.receipts.invoiceId, id))) {
      await db.delete(s.receipts).where(eq(s.receipts.id, r.id));
      await audit(db, clinicId, "purge", "receipt", r.id, r);
    }
    await db.delete(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, id));
  }
  if (kind === "file") await env.FILES?.delete((row as typeof s.files.$inferSelect).r2Key);

  await db.delete(t).where(eq(t.id, id));
  await audit(db, clinicId, "purge", kind, id, kind === "invoice" || kind === "receipt" ? row : undefined);
  return true;
}

/** Nightly job: purge everything deleted more than 30 days ago. */
export async function purgeExpired(db: Db, env: { FILES?: R2Bucket }, now = new Date()) {
  const cutoff = purgeBefore(now);
  let count = 0;
  for (const kind of Object.keys(TRASHABLE) as TrashKind[]) {
    const t = TRASHABLE[kind];
    const rows = await db.select({ id: t.id, clinicId: t.clinicId }).from(t).where(and(isNotNull(t.deletedAt), lt(t.deletedAt, cutoff)));
    for (const r of rows) if (await purgeOne(db, env, r.clinicId, kind, r.id)) count++;
  }
  return count;
}
