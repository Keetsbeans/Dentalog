import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { CLINIC_ID, type Env } from "./env";
import { perms, type Perm, type Role } from "../shared/roles";
import { readSettings } from "../shared/settings";

/**
 * Everyone signs in with their own email and password. Passwords are stored only as PBKDF2 hashes.
 * A session is a 30-day cookie "<user>.<version>.<expiry>.<signature>", signed with a key made from the
 * DENTALOG_PASSWORD secret. Changing that secret signs every device out; resetting one person's password
 * or switching their login off signs just them out (their session version goes up).
 *
 * The clinic password (the secret) is still used for two things only: creating the owner's login the
 * first time, and letting the owner set a new password if they forget theirs.
 * Five wrong tries from one address in 15 minutes locks that address for the rest of the window.
 */
const COOKIE = "dl_session";
const DAYS = 30;
const MAX_TRIES = 5;
const WINDOW_MIN = 15;
/** Cloudflare Workers allow up to 100,000 PBKDF2 iterations. */
const ITERATIONS = 100_000;

export type SessionUser = { id: string; name: string; email: string; role: Role; qualification: string | null };
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; perms: Perm[] } };
type C = Context<AppEnv>;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`dentalog-session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

/** Compares without leaking how much matched. */
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i]! ^ ub[i]!;
  return diff === 0;
}

export async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

/** A rule every new password must meet, in words a person can act on. */
export function passwordProblem(p: string | undefined): string | null {
  if (!p || p.length < 8) return "Use at least 8 characters for the password.";
  if (p.length > 200) return "That password is too long.";
  return null;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type UserRow = { id: string; name: string; email: string; role: Role; qualification: string | null; password_hash: string; password_salt: string; active: number; session_version: number };
const userByEmail = (env: Env, email: string) =>
  env.DB.prepare("SELECT * FROM users WHERE email = ? AND clinic_id = ?").bind(email.trim().toLowerCase(), CLINIC_ID).first<UserRow>();
const userById = (env: Env, id: string) =>
  env.DB.prepare("SELECT * FROM users WHERE id = ? AND clinic_id = ?").bind(id, CLINIC_ID).first<UserRow>();
const userCount = async (env: Env) => (await env.DB.prepare("SELECT count(*) AS n FROM users WHERE clinic_id = ?").bind(CLINIC_ID).first<{ n: number }>())?.n ?? 0;

async function readSession(env: Env, cookie: string | undefined): Promise<SessionUser | null> {
  if (!env.DENTALOG_PASSWORD || !cookie) return null;
  const [uid, ver, exp, sig] = cookie.split(".");
  if (!uid || !ver || !exp || !sig || Number(exp) < Date.now()) return null;
  if (!(await same(sig, await hmac(env.DENTALOG_PASSWORD, `${uid}.${ver}.${exp}`)))) return null;
  const u = await userById(env, uid);
  if (!u || !u.active || String(u.session_version) !== ver) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, qualification: u.qualification };
}

async function startSession(c: C, u: { id: string; session_version: number }) {
  const exp = String(Date.now() + DAYS * 86_400_000);
  const body = `${u.id}.${u.session_version}.${exp}`;
  setCookie(c, COOKIE, `${body}.${await hmac(c.env.DENTALOG_PASSWORD!, body)}`, {
    httpOnly: true, sameSite: "Lax", path: "/", maxAge: DAYS * 86_400,
    secure: new URL(c.req.url).protocol === "https:",
  });
  await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), u.id).run();
}

const ip = (c: C) => c.req.header("cf-connecting-ip") ?? "local";

async function recentFailures(env: Env, from: string) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM audit_log WHERE entity = 'login' AND entity_id = ? AND action = 'login_failed' AND created_at > ?",
  ).bind(from, since).first<{ n: number }>();
  return row?.n ?? 0;
}

async function log(env: Env, actor: string, action: string, from: string) {
  await env.DB.prepare("INSERT INTO audit_log (clinic_id, actor, action, entity, entity_id) VALUES (?, ?, ?, 'login', ?)")
    .bind(CLINIC_ID, actor, action, from).run();
}

async function guardTries(c: C) {
  if (!c.env.DENTALOG_PASSWORD) return c.json({ error: "The clinic password hasn’t been set up in Cloudflare yet." }, 503);
  if ((await recentFailures(c.env, ip(c))) >= MAX_TRIES) return c.json({ error: `Too many wrong tries. Wait ${WINDOW_MIN} minutes and try again.` }, 429);
  return null;
}

export async function login(c: C) {
  const stop = await guardTries(c); if (stop) return stop;
  const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const u = b.email ? await userByEmail(c.env, b.email) : null;
  // Hash even when there's no such person, so a wrong email takes as long as a wrong password.
  const { hash } = await hashPassword(b.password ?? "", u?.password_salt ?? "AAAAAAAAAAAAAAAAAAAAAA==");
  if (!u || !(await same(hash, u.password_hash))) {
    await log(c.env, b.email?.trim().toLowerCase() || "unknown", "login_failed", ip(c));
    return c.json({ error: "That email or password is not right." }, 401);
  }
  if (!u.active) return c.json({ error: "This login has been switched off. Please ask the clinic owner." }, 403);
  await log(c.env, u.name, "login", ip(c));
  await startSession(c, u);
  return c.json({ ok: true });
}

/** First run: the clinic password proves this is the owner; they choose their own email and password. */
export async function setupOwner(c: C) {
  const stop = await guardTries(c); if (stop) return stop;
  if ((await userCount(c.env)) > 0) return c.json({ error: "The owner’s login is already set up. Sign in with your email." }, 409);
  const b = await c.req.json<{ clinicPassword?: string; name?: string; email?: string; password?: string; qualification?: string }>();
  if (!(await same(b.clinicPassword ?? "", c.env.DENTALOG_PASSWORD!))) {
    await log(c.env, "setup", "login_failed", ip(c));
    return c.json({ error: "That clinic password is not right." }, 401);
  }
  const email = b.email?.trim().toLowerCase() ?? "";
  if (!b.name?.trim()) return c.json({ error: "Enter your name." }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address." }, 400);
  const bad = passwordProblem(b.password); if (bad) return c.json({ error: bad }, 400);
  const { hash, salt } = await hashPassword(b.password!);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO users (id, clinic_id, name, email, role, qualification, password_hash, password_salt) VALUES (?, ?, ?, ?, 'owner', ?, ?, ?)")
    .bind(id, CLINIC_ID, b.name.trim(), email, b.qualification?.trim() || null, hash, salt).run();
  await log(c.env, b.name.trim(), "login", ip(c));
  await startSession(c, { id, session_version: 1 });
  return c.json({ ok: true });
}

/** Owner forgot their password: the clinic password from Cloudflare lets them choose a new one. */
export async function resetOwner(c: C) {
  const stop = await guardTries(c); if (stop) return stop;
  const b = await c.req.json<{ clinicPassword?: string; email?: string; password?: string }>();
  const u = b.email ? await userByEmail(c.env, b.email) : null;
  if (!(await same(b.clinicPassword ?? "", c.env.DENTALOG_PASSWORD!)) || !u || u.role !== "owner") {
    await log(c.env, b.email?.trim().toLowerCase() || "unknown", "login_failed", ip(c));
    return c.json({ error: "That email or clinic password is not right. Only the owner can reset this way; staff ask the owner." }, 401);
  }
  const bad = passwordProblem(b.password); if (bad) return c.json({ error: bad }, 400);
  const { hash, salt } = await hashPassword(b.password!);
  const ver = u.session_version + 1;
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, session_version = ?, active = 1 WHERE id = ?").bind(hash, salt, ver, u.id).run();
  await log(c.env, u.name, "password_reset", ip(c));
  await startSession(c, { id: u.id, session_version: ver });
  return c.json({ ok: true });
}

/** Anyone signed in can change their own password (they need the current one). */
export async function changeOwnPassword(c: C) {
  const me_ = c.get("user");
  const b = await c.req.json<{ current?: string; password?: string }>();
  const u = await userById(c.env, me_.id);
  if (!u) return c.json({ error: "Please sign in again." }, 401);
  const { hash: cur } = await hashPassword(b.current ?? "", u.password_salt);
  if (!(await same(cur, u.password_hash))) return c.json({ error: "Your current password is not right." }, 400);
  const bad = passwordProblem(b.password); if (bad) return c.json({ error: bad }, 400);
  const { hash, salt } = await hashPassword(b.password!);
  const ver = u.session_version + 1;
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, session_version = ? WHERE id = ?").bind(hash, salt, ver, u.id).run();
  await startSession(c, { id: u.id, session_version: ver });
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

async function receptionBilling(env: Env) {
  const row = await env.DB.prepare("SELECT settings_json FROM clinics WHERE id = ?").bind(CLINIC_ID).first<{ settings_json: string }>();
  return readSettings(row?.settings_json).receptionBilling;
}

/** Who is signed in, what they may do, and whether the owner still needs to set up their login. */
export async function me(c: C) {
  if (!c.env.DENTALOG_PASSWORD) return c.json({ error: "not_set_up" }, 503);
  const u = await readSession(c.env, getCookie(c, COOKIE));
  if (!u) return c.json({ error: "signed_out", firstRun: (await userCount(c.env)) === 0 }, 401);
  return c.json({ user: u, perms: perms(u.role, { receptionBilling: await receptionBilling(c.env) }) });
}

/** Which permission each kind of request needs. Anything not listed is open to everyone signed in. */
const RULES: [string, RegExp, Perm][] = [
  ["PUT", /^\/api\/clinic$/, "settings"],
  ["PUT", /^\/api\/clinic\/images\//, "settings"],
  ["DELETE", /^\/api\/clinic\/images\//, "settings"],
  ["GET", /^\/api\/(export|activity|storage)$/, "settings"],
  ["*", /^\/api\/staff/, "settings"],
  ["POST", /^\/api\/patients\/import$/, "settings"],
  ["GET", /^\/api\/reports/, "money.totals"],
  ["GET", /^\/api\/messages(\/queue)?$/, "messages.send"],
  ["POST", /^\/api\/messages$/, "messages.send"],
  ["GET", /^\/api\/messages\/requests$/, "messages.send"],
  ["PATCH", /^\/api\/messages\/requests\//, "messages.send"],
  ["DELETE", /^\/api\/messages\/requests\//, "messages.send"],
  ["POST", /^\/api\/lab-orders$/, "lab.write"],
  ["PUT", /^\/api\/patients\/[^/]+\/teeth\//, "clinical.write"],
  ["POST", /^\/api\/visits/, "clinical.write"],
  ["PUT", /^\/api\/visits\//, "clinical.write"],
  ["GET", /^\/api\/(invoices|receipts)/, "billing.view"],
  ["POST", /^\/api\/invoices/, "billing.take"],
  ["PUT", /^\/api\/invoices\//, "billing.edit"],
  ["PATCH", /^\/api\/files\//, "files.edit"],
  ["*", /^\/api\/trash/, "delete"],
  ["DELETE", /^\/api\//, "delete"],
];

export function needed(method: string, path: string): Perm | null {
  for (const [m, re, p] of RULES) if ((m === "*" || m === method) && re.test(path)) return p;
  return null;
}

const OPEN = new Set(["/api/health", "/api/login", "/api/logout", "/api/me", "/api/setup", "/api/reset-owner"]);

/** Every API call except the open ones needs a signed-in person with the right permission. */
export async function requireSession(c: C, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (OPEN.has(path)) return next();
  // The patient's own appointment link has no sign-in; its random token is the key.
  if (path.startsWith("/api/public/")) return next();
  const u = await readSession(c.env, getCookie(c, COOKIE));
  if (!u) return c.json({ error: "Please sign in again." }, 401);
  const p = perms(u.role, { receptionBilling: u.role === "reception" ? await receptionBilling(c.env) : false });
  c.set("user", u); c.set("perms", p);
  const need = needed(c.req.method, path);
  if (need && !p.includes(need)) return c.json({ error: "Your login doesn’t allow this. Please ask the clinic owner." }, 403);
  return next();
}

/** For handlers: does the signed-in person have this permission? */
export const allowed = (c: Context, perm: Perm) => ((c as unknown as C).get("perms") ?? []).includes(perm);
/** For the activity log: who did it. */
export const who = (c: Context) => ({ clinicId: CLINIC_ID, actor: (c as unknown as C).get("user")?.name ?? "system" });
