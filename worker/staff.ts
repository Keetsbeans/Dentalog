import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID } from "./env";
import { EMAIL_RE, hashPassword, passwordProblem, who, type AppEnv } from "./auth";
import { audit } from "./trash";
import { KINDS, type MessageKind } from "../shared/messages";

type C = Context<AppEnv>;
const db = (c: C) => drizzle(c.env.DB, { schema: s });
const cols = { id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, qualification: s.users.qualification, active: s.users.active, lastLoginAt: s.users.lastLoginAt, createdAt: s.users.createdAt };
const STAFF_ROLES = ["doctor", "reception"] as const;

// ---------- Staff logins (owner only; the route rules enforce that) ----------

export async function listStaff(c: C) {
  return c.json(await db(c).select(cols).from(s.users).where(eq(s.users.clinicId, CLINIC_ID)).orderBy(s.users.createdAt));
}

export async function addStaff(c: C) {
  const b = await c.req.json<{ name?: string; email?: string; role?: string; qualification?: string; password?: string }>();
  const email = b.email?.trim().toLowerCase() ?? "";
  if (!b.name?.trim()) return c.json({ error: "Enter their name." }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address." }, 400);
  if (!STAFF_ROLES.includes(b.role as never)) return c.json({ error: "Choose Doctor or Receptionist." }, 400);
  const bad = passwordProblem(b.password); if (bad) return c.json({ error: bad }, 400);
  const [taken] = await db(c).select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
  if (taken) return c.json({ error: "Someone already signs in with that email." }, 409);
  const { hash, salt } = await hashPassword(b.password!);
  const id = crypto.randomUUID();
  await db(c).insert(s.users).values({ id, clinicId: CLINIC_ID, name: b.name.trim(), email, role: b.role as "doctor" | "reception", qualification: b.qualification?.trim() || null, passwordHash: hash, passwordSalt: salt });
  await audit(db(c), who(c), "create", "staff", id, { name: b.name.trim(), role: b.role });
  return c.json({ id }, 201);
}

export async function editStaff(c: C) {
  const id = c.req.param("id")!;
  const b = await c.req.json<{ name?: string; role?: string; qualification?: string | null; active?: boolean; password?: string }>();
  const [u] = await db(c).select().from(s.users).where(and(eq(s.users.id, id), eq(s.users.clinicId, CLINIC_ID)));
  if (!u) return c.json({ error: "That login was not found." }, 404);
  const self = id === c.get("user").id;
  const set: Partial<typeof s.users.$inferInsert> = {};
  if (b.name !== undefined) { if (!b.name.trim()) return c.json({ error: "Enter their name." }, 400); set.name = b.name.trim(); }
  if (b.qualification !== undefined) set.qualification = b.qualification?.trim() || null;
  if (b.role !== undefined && b.role !== u.role) {
    if (u.role === "owner" || !STAFF_ROLES.includes(b.role as never)) return c.json({ error: "The owner’s role can’t be changed here." }, 400);
    set.role = b.role as "doctor" | "reception";
  }
  let signOut = false;
  if (b.active !== undefined && b.active !== u.active) {
    if (self) return c.json({ error: "You can’t switch off your own login." }, 400);
    set.active = b.active; signOut = !b.active;
  }
  if (b.password !== undefined) {
    const bad = passwordProblem(b.password); if (bad) return c.json({ error: bad }, 400);
    const { hash, salt } = await hashPassword(b.password);
    set.passwordHash = hash; set.passwordSalt = salt; signOut = true;
  }
  if (signOut || set.role) set.sessionVersion = u.sessionVersion + 1;
  if (!Object.keys(set).length) return c.json({ error: "Nothing to change." }, 400);
  await db(c).update(s.users).set(set).where(eq(s.users.id, id));
  await audit(db(c), who(c), "update", "staff", id, Object.keys(set).filter((k) => !k.startsWith("password")));
  return c.json({ ok: true });
}

// ---------- Messages a doctor or receptionist asks the owner to send ----------

export async function requestMessage(c: C) {
  const b = await c.req.json<{ patientId?: string; body?: string; kind?: string }>();
  if (!b.patientId || !b.body?.trim()) return c.json({ error: "Write the message first." }, 400);
  const [p] = await db(c).select({ id: s.patients.id }).from(s.patients).where(and(eq(s.patients.id, b.patientId), eq(s.patients.clinicId, CLINIC_ID)));
  if (!p) return c.json({ error: "That patient was not found." }, 404);
  const kind: MessageKind | "other" = KINDS.includes(b.kind as MessageKind) ? (b.kind as MessageKind) : "other";
  const id = crypto.randomUUID();
  await db(c).insert(s.messages).values({ id, clinicId: CLINIC_ID, patientId: p.id, kind, body: b.body.trim().slice(0, 2000), status: "requested", byUser: c.get("user").id, createdAt: new Date().toISOString() });
  await audit(db(c), who(c), "request", "message", id);
  return c.json({ id }, 201);
}

export async function listRequests(c: C) {
  const rows = await db(c).select({ m: s.messages, p: { id: s.patients.id, name: s.patients.name, code: s.patients.code, phone: s.patients.phone, phoneCc: s.patients.phoneCc, consent: s.patients.whatsappConsent }, by: s.users.name })
    .from(s.messages).innerJoin(s.patients, eq(s.patients.id, s.messages.patientId)).leftJoin(s.users, eq(s.users.id, s.messages.byUser))
    .where(and(eq(s.messages.clinicId, CLINIC_ID), eq(s.messages.status, "requested"))).orderBy(desc(s.messages.createdAt));
  return c.json(rows.map(({ m, p, by }) => ({ id: m.id, kind: m.kind, body: m.body, createdAt: m.createdAt, patient: p, by: by ?? "Staff" })));
}

/** The owner sent it (opened WhatsApp): it becomes a normal sent message, possibly reworded. */
export async function sendRequest(c: C) {
  const id = c.req.param("id")!;
  const b = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const set: Partial<typeof s.messages.$inferInsert> = { status: "sent", createdAt: new Date().toISOString() };
  if (b.body?.trim()) set.body = b.body.trim().slice(0, 2000);
  const r = await db(c).update(s.messages).set(set).where(and(eq(s.messages.id, id), eq(s.messages.clinicId, CLINIC_ID), eq(s.messages.status, "requested"))).returning({ id: s.messages.id });
  return r.length ? c.json({ ok: true, createdAt: set.createdAt }) : c.json({ error: "That request was not found." }, 404);
}

export async function dropRequest(c: C) {
  const id = c.req.param("id")!;
  await db(c).delete(s.messages).where(and(eq(s.messages.id, id), eq(s.messages.clinicId, CLINIC_ID), eq(s.messages.status, "requested")));
  await audit(db(c), who(c), "discard", "message", id);
  return c.json({ ok: true });
}
