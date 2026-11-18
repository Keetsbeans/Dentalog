import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { utcToIst, label12 } from "../shared/time";
import { EMAIL } from "../shared/phone";

/*
 * The patient's appointment link (/c/<token>). No sign-in: the long random token is the key,
 * and the page shows only what the patient already knows (their first name, the time, the clinic).
 */

type C = Context<{ Bindings: Env }>;
const db = (env: Env) => drizzle(env.DB, { schema: s });
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The appointment's link token, made the first time it's needed. */
export async function confirmToken(env: Env, apptId: string, existing: string | null) {
  if (existing) return existing;
  const token = newToken();
  await db(env).update(s.appointments).set({ confirmToken: token }).where(eq(s.appointments.id, apptId));
  return token;
}

async function find(env: Env, token: string) {
  if (!TOKEN.test(token)) return null;
  const [row] = await db(env).select({ a: s.appointments, p: s.patients }).from(s.appointments)
    .innerJoin(s.patients, eq(s.patients.id, s.appointments.patientId))
    .where(and(eq(s.appointments.confirmToken, token), eq(s.appointments.clinicId, CLINIC_ID), isNull(s.appointments.deletedAt), isNull(s.patients.deletedAt)));
  return row ?? null;
}

const fmt = (day: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

async function view(env: Env, row: NonNullable<Awaited<ReturnType<typeof find>>>) {
  const [clinic] = await db(env).select().from(s.clinics).where(eq(s.clinics.id, CLINIC_ID));
  const { day, time } = utcToIst(row.a.startsAt);
  const past = new Date(row.a.startsAt).getTime() + row.a.minutes * 60_000 < Date.now();
  return {
    clinic: { name: clinic?.name ?? "", phone: clinic?.phone ?? null, address: clinic?.address ?? null },
    firstName: row.p.name.split(/\s+/)[0],
    when: `${fmt(day)} at ${label12(time)}`, visit: row.a.visitType,
    status: row.a.status === "cancelled" ? "cancelled" : past ? "past" : row.a.rescheduleAt && (!row.a.confirmedAt || row.a.rescheduleAt > row.a.confirmedAt) ? "reschedule" : row.a.confirmedAt ? "confirmed" : "open",
    email: row.p.email, emailConfirmed: !!row.p.emailConfirmedAt,
  };
}

export async function publicGet(c: C) {
  const row = await find(c.env, c.req.param("token")!);
  if (!row) return c.json({ error: "This link isn’t valid any more. Please contact the clinic." }, 404);
  return c.json(await view(c.env, row));
}

/** Confirm, ask for another time, and/or confirm an email address. */
export async function publicPost(c: C) {
  const row = await find(c.env, c.req.param("token")!);
  if (!row) return c.json({ error: "This link isn’t valid any more. Please contact the clinic." }, 404);
  const b = await c.req.json<{ action?: "confirm" | "reschedule"; email?: string }>();
  const v = await view(c.env, row);
  if (b.action && (v.status === "cancelled" || v.status === "past")) return c.json({ error: "This appointment can’t be changed from here. Please call the clinic." }, 400);
  const d = db(c.env);
  const now = new Date().toISOString();
  const notes: string[] = [];
  if (b.action === "confirm") { await d.update(s.appointments).set({ confirmedAt: now }).where(eq(s.appointments.id, row.a.id)); notes.push(`Confirmed the appointment on ${v.when}`); }
  if (b.action === "reschedule") { await d.update(s.appointments).set({ rescheduleAt: now }).where(eq(s.appointments.id, row.a.id)); notes.push(`Asked for another time instead of ${v.when}`); }
  if (b.email !== undefined) {
    const email = b.email.trim().toLowerCase();
    if (!EMAIL.test(email)) return c.json({ error: "That email doesn’t look right. Please check it." }, 400);
    await d.update(s.patients).set({ email, emailConfirmedAt: now }).where(eq(s.patients.id, row.p.id));
    notes.push(`Confirmed their email: ${email}`);
  }
  if (!notes.length) return c.json({ error: "Nothing to do." }, 400);
  await d.insert(s.messages).values({ id: crypto.randomUUID(), clinicId: CLINIC_ID, patientId: row.p.id, kind: "patient", direction: "in", refId: row.a.id, body: notes.join(". ") + ".", createdAt: now });
  const fresh = await find(c.env, c.req.param("token")!);
  return c.json(await view(c.env, fresh!));
}
