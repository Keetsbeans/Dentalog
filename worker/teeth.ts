import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import * as s from "./db/schema";
import { CLINIC_ID, type Env } from "./env";
import { blank, complete, CONDITIONS, isTooth, PLANS, sittings, type Condition, type PlanName, type ToothState } from "../shared/teeth";

type C = Context<{ Bindings: Env }>;
const db = (env: Env) => drizzle(env.DB, { schema: s });

const toState = (r: typeof s.teeth.$inferSelect): ToothState => ({
  tooth: r.tooth, condition: (CONDITIONS as readonly string[]).includes(r.condition) ? (r.condition as Condition) : "Healthy",
  plan: r.plan && r.plan in PLANS ? (r.plan as PlanName) : null, done: r.done, billed: r.billed,
});

async function patientOk(env: Env, id: string) {
  const [p] = await db(env).select({ id: s.patients.id }).from(s.patients)
    .where(and(eq(s.patients.id, id), eq(s.patients.clinicId, CLINIC_ID), isNull(s.patients.deletedAt)));
  return !!p;
}

/** The chart and its history for one patient. */
export async function getTeeth(c: C) {
  const id = c.req.param("id")!;
  if (!(await patientOk(c.env, id))) return c.json({ error: "That patient was not found." }, 404);
  const d = db(c.env);
  const [rows, events] = await Promise.all([
    d.select().from(s.teeth).where(and(eq(s.teeth.patientId, id), eq(s.teeth.clinicId, CLINIC_ID))),
    d.select({ id: s.toothEvents.id, tooth: s.toothEvents.tooth, text: s.toothEvents.text, createdAt: s.toothEvents.createdAt })
      .from(s.toothEvents).where(and(eq(s.toothEvents.patientId, id), eq(s.toothEvents.clinicId, CLINIC_ID)))
      .orderBy(desc(s.toothEvents.createdAt)).limit(100),
  ]);
  return c.json({ teeth: rows.map(toState), events });
}

type Change = { condition?: string; plan?: string | null; done?: number; billed?: boolean; restore?: ToothState };

/** Change one tooth. Planning a new treatment starts its sittings at 0; finishing the last sitting updates the condition. */
export async function putTooth(c: C) {
  const id = c.req.param("id")!;
  const n = Number(c.req.param("n"));
  if (!isTooth(n)) return c.json({ error: "That is not a tooth number." }, 400);
  if (!(await patientOk(c.env, id))) return c.json({ error: "That patient was not found." }, 404);
  const b = await c.req.json<Change>();
  const d = db(c.env);
  const [row] = await d.select().from(s.teeth).where(and(eq(s.teeth.patientId, id), eq(s.teeth.tooth, n)));
  const before = row ? toState(row) : blank(n);
  let t: ToothState = { ...before };
  const notes: string[] = [];

  if (b.restore) {
    const r = b.restore;
    if (!(CONDITIONS as readonly string[]).includes(r.condition) || (r.plan !== null && !(r.plan in PLANS))) return c.json({ error: "Can’t undo that." }, 400);
    t = { tooth: n, condition: r.condition, plan: r.plan, done: Math.max(0, Math.min(Number(r.done) || 0, r.plan ? PLANS[r.plan].steps.length : 0)), billed: !!r.billed };
    notes.push("Change undone");
  } else {
    if (b.condition !== undefined && b.condition !== t.condition) {
      if (!(CONDITIONS as readonly string[]).includes(b.condition)) return c.json({ error: "Choose a condition from the list." }, 400);
      t.condition = b.condition as Condition;
      notes.push(`Marked ${t.condition.toLowerCase()}`);
    }
    if (b.plan !== undefined && b.plan !== t.plan) {
      if (b.plan !== null && !(b.plan in PLANS)) return c.json({ error: "Choose a treatment from the list." }, 400);
      if (t.plan && t.done > 0 && !complete(t) && b.plan !== null) notes.push(`${PLANS[t.plan].label} stopped after ${t.done} of ${sittings(t)} sittings`);
      t.plan = b.plan as PlanName | null; t.done = 0; t.billed = false;
      notes.push(t.plan ? `${PLANS[t.plan].label} planned` : "Treatment plan removed");
    }
    if (b.done !== undefined && t.plan && b.done !== t.done) {
      const max = sittings(t);
      if (!Number.isInteger(b.done) || b.done < 0 || b.done > max) return c.json({ error: "That sitting number doesn’t fit the plan." }, 400);
      const steps = PLANS[t.plan].steps;
      if (b.done > t.done) {
        notes.push(`${PLANS[t.plan].label}: sitting ${b.done} of ${max} (${steps[b.done - 1]}) done`);
        if (b.done === max) { t.condition = PLANS[t.plan].after; notes.push(`${PLANS[t.plan].label} complete`); }
      } else notes.push(`${PLANS[t.plan].label}: back to ${b.done} of ${max} sittings`);
      t.done = b.done;
    }
    if (b.billed !== undefined && b.billed !== t.billed) { t.billed = b.billed; if (b.billed) notes.push("Billed"); }
  }
  if (!notes.length) return c.json({ tooth: t, before });

  const now = new Date().toISOString();
  await d.insert(s.teeth).values({ clinicId: CLINIC_ID, patientId: id, tooth: n, condition: t.condition, plan: t.plan, done: t.done, billed: t.billed, updatedAt: now })
    .onConflictDoUpdate({ target: [s.teeth.patientId, s.teeth.tooth], set: { condition: t.condition, plan: t.plan, done: t.done, billed: t.billed, updatedAt: now } });
  await d.insert(s.toothEvents).values({ id: crypto.randomUUID(), clinicId: CLINIC_ID, patientId: id, tooth: n, text: notes.join(" · "), createdAt: now });
  return c.json({ tooth: t, before });
}
