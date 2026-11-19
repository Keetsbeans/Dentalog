import { who } from "./auth";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { audit } from "./trash";

type C = Context<{ Bindings: Env }>;
const db = (env: Env) => drizzle(env.DB, { schema: s });

export const IMAGE_KEYS = ["logo", "letterhead", "receiptHead", "signature"] as const;
export type ImageKey = (typeof IMAGE_KEYS)[number];
const isKey = (k: string): k is ImageKey => (IMAGE_KEYS as readonly string[]).includes(k);
const TYPES = ["image/png", "image/jpeg", "image/webp"];
/** The browser shrinks pictures first, so this is only a guard. D1 keeps up to 2 MB in a row. */
const MAX = 1_500_000;

/** When each picture was last changed, for cache-busting. Missing = use the built-in one. */
export async function imageVersions(env: Env): Promise<Partial<Record<ImageKey, string>>> {
  const rows = await db(env).select({ key: s.clinicImages.key, at: s.clinicImages.updatedAt }).from(s.clinicImages).where(eq(s.clinicImages.clinicId, CLINIC_ID));
  return Object.fromEntries(rows.map((r) => [r.key, r.at]));
}

// Raw D1 here: the bytes go in and out as a BLOB without needing Node's Buffer.
export async function getImage(c: C) {
  const key = c.req.param("key")!;
  if (!isKey(key)) return c.json({ error: "Unknown picture." }, 404);
  const row = await c.env.DB.prepare("SELECT content_type, data FROM clinic_images WHERE clinic_id = ? AND key = ?").bind(CLINIC_ID, key)
    .first<{ content_type: string; data: number[] | ArrayBuffer }>();
  if (!row) return c.json({ error: "Not uploaded yet." }, 404);
  return new Response(new Uint8Array(row.data as ArrayLike<number>), { headers: { "content-type": row.content_type, "cache-control": "private, max-age=31536000, immutable" } });
}

export async function putImage(c: C) {
  const key = c.req.param("key")!;
  if (!isKey(key)) return c.json({ error: "Unknown picture." }, 404);
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (!TYPES.includes(type)) return c.json({ error: "Upload a PNG or JPG picture." }, 400);
  const data = await c.req.arrayBuffer();
  if (!data.byteLength) return c.json({ error: "The picture is empty." }, 400);
  if (data.byteLength > MAX) return c.json({ error: "That picture is too large. Try a smaller one." }, 400);
  const updatedAt = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO clinic_images (clinic_id, key, content_type, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (clinic_id, key) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at",
  ).bind(CLINIC_ID, key, type, data, updatedAt).run();
  await audit(db(c.env), who(c), "upload", "picture", key, { bytes: data.byteLength });
  return c.json({ key, updatedAt });
}

export async function deleteImage(c: C) {
  const key = c.req.param("key")!;
  if (!isKey(key)) return c.json({ error: "Unknown picture." }, 404);
  await c.env.DB.prepare("DELETE FROM clinic_images WHERE clinic_id = ? AND key = ?").bind(CLINIC_ID, key).run();
  await audit(db(c.env), who(c), "remove", "picture", key);
  return c.json({ ok: true });
}

/** Everything the clinic owns, one list per table, for Export to Excel. Deleted rows are left out. */
export async function exportAll(c: C) {
  const d = db(c.env);
  const live = <T extends { clinicId: unknown; deletedAt: unknown }>(t: T) => and(eq(t.clinicId as typeof s.patients.clinicId, CLINIC_ID), isNull(t.deletedAt as typeof s.patients.deletedAt));
  const [patients, appointments, visits, items, invoices, lines, receipts, labs, messages, teeth] = await Promise.all([
    d.select().from(s.patients).where(live(s.patients)),
    d.select().from(s.appointments).where(live(s.appointments)),
    d.select().from(s.visits).where(live(s.visits)),
    d.select().from(s.prescriptionItems),
    d.select().from(s.invoices).where(live(s.invoices)),
    d.select().from(s.invoiceLines),
    d.select().from(s.receipts).where(live(s.receipts)),
    d.select().from(s.labOrders).where(live(s.labOrders)),
    d.select().from(s.messages).where(eq(s.messages.clinicId, CLINIC_ID)),
    d.select().from(s.teeth).where(eq(s.teeth.clinicId, CLINIC_ID)),
  ]);
  const visitIds = new Set(visits.map((v) => v.id)), invIds = new Set(invoices.map((i) => i.id));
  const strip = <T extends Record<string, unknown>>(rows: T[]) => rows.map(({ clinicId: _c, deletedAt: _d, deletedReason: _r, confirmToken: _t, ...r }) => r);
  await audit(d, who(c), "export", "clinic", CLINIC_ID);
  return c.json({
    Patients: strip(patients), Appointments: strip(appointments), Visits: strip(visits),
    Prescriptions: strip(items.filter((i) => visitIds.has(i.visitId))),
    Bills: strip(invoices), "Bill lines": strip(lines.filter((l) => invIds.has(l.invoiceId))),
    Payments: strip(receipts), "Lab orders": strip(labs), Messages: strip(messages), "Tooth chart": strip(teeth),
  });
}

/** The latest entries in the activity log. */
export async function activity(c: C) {
  const rows = await db(c.env).select().from(s.auditLog).where(eq(s.auditLog.clinicId, CLINIC_ID)).orderBy(desc(s.auditLog.id)).limit(200);
  return c.json(rows.map(({ clinicId: _c, ...r }) => r));
}
