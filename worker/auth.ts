import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";

/**
 * One clinic password, kept as a Cloudflare secret (DENTALOG_PASSWORD).
 * Signing in gives a 30-day cookie signed with a key made from the password,
 * so changing the password signs every device out.
 * Five wrong tries from one address in 15 minutes locks that address for the rest of the window.
 */
const COOKIE = "dl_session";
const DAYS = 30;
const MAX_TRIES = 5;
const WINDOW_MIN = 15;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

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

export async function sessionValid(env: Env, cookie: string | undefined) {
  if (!env.DENTALOG_PASSWORD || !cookie) return false;
  const [exp, sig] = cookie.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac(env.DENTALOG_PASSWORD, exp));
}

const ip = (c: Context) => c.req.header("cf-connecting-ip") ?? "local";

async function recentFailures(env: Env, from: string) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM audit_log WHERE entity = 'login' AND entity_id = ? AND action = 'login_failed' AND created_at > ?",
  ).bind(from, since).first<{ n: number }>();
  return row?.n ?? 0;
}

async function log(env: Env, action: string, from: string) {
  await env.DB.prepare("INSERT INTO audit_log (clinic_id, actor, action, entity, entity_id) VALUES ('oyster', 'doctor', ?, 'login', ?)")
    .bind(action, from).run();
}

export async function login(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  if (!env.DENTALOG_PASSWORD) return c.json({ error: "The clinic password hasn’t been set up in Cloudflare yet." }, 503);
  const from = ip(c);
  if ((await recentFailures(env, from)) >= MAX_TRIES) return c.json({ error: `Too many wrong tries. Wait ${WINDOW_MIN} minutes and try again.` }, 429);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  if (!(await same(password ?? "", env.DENTALOG_PASSWORD))) {
    await log(env, "login_failed", from);
    return c.json({ error: "That password is not right." }, 401);
  }
  await log(env, "login", from);
  const exp = String(Date.now() + DAYS * 86_400_000);
  setCookie(c, COOKIE, `${exp}.${await hmac(env.DENTALOG_PASSWORD, exp)}`, {
    httpOnly: true, sameSite: "Lax", path: "/", maxAge: DAYS * 86_400,
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export async function me(c: Context<{ Bindings: Env }>) {
  if (!c.env.DENTALOG_PASSWORD) return c.json({ error: "not_set_up" }, 503);
  return (await sessionValid(c.env, getCookie(c, COOKIE))) ? c.json({ ok: true }) : c.json({ error: "signed_out" }, 401);
}

/** Every API call except health, login and me needs a valid session. */
export async function requireSession(c: Context<{ Bindings: Env }>, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health" || path === "/api/login" || path === "/api/logout" || path === "/api/me") return next();
  if (!(await sessionValid(c.env, getCookie(c, COOKIE)))) return c.json({ error: "Please sign in again." }, 401);
  return next();
}
