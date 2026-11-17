import { Hono } from "hono";
import { and, asc, desc, eq, gte, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { audit, isTrashKind, purgeExpired, purgeOne, restore, softDelete, type TrashKind } from "./trash";
import { daysLeft, removalDate } from "../shared/trash";
import { formatNumber, type Series } from "../shared/numbering";
import { istToUtc, label12, overlaps, utcToIst } from "../shared/time";

const app = new Hono<{ Bindings: Env }>().basePath("/api");
const db = (env: Env) => drizzle(env.DB, { schema: s });

app.get("/health", (c) => c.json({ ok: true, app: "Dentalog" }));

app.get("/clinic", async (c) => {
  const [clinic] = await db(c.env).select().from(s.clinics).where(eq(s.clinics.id, CLINIC_ID));
  return clinic ? c.json(clinic) : c.json({ error: "Clinic not set up yet." }, 404);
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
    push("receipt", r.id, `Receipt ${r.number}`, `${r.mode.toUpperCase()} · ${r.amountPaise / 100}`, r.deletedAt, r.deletedReason);
  for (const r of await d.select().from(s.invoices).where(and(eq(s.invoices.clinicId, CLINIC_ID), isNotNull(s.invoices.deletedAt))))
    push("invoice", r.id, `Invoice ${r.number}`, `${r.totalPaise / 100}`, r.deletedAt, r.deletedReason);
  for (const r of await d.select().from(s.labOrders).where(and(eq(s.labOrders.clinicId, CLINIC_ID), isNotNull(s.labOrders.deletedAt))))
    push("lab", r.id, `Lab order ${r.number} · ${r.work}`, r.lab, r.deletedAt, r.deletedReason);
  for (const { a, name } of await d.select({ a: s.appointments, name: s.patients.name }).from(s.appointments)
    .innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
    .where(and(eq(s.appointments.clinicId, CLINIC_ID), isNotNull(s.appointments.deletedAt)))) {
    const { day, time } = utcToIst(a.startsAt);
    push("appointment", a.id, `Appointment · ${name}`, `${a.visitType} · ${day} ${label12(time)}`, a.deletedAt, a.deletedReason);
  }
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

