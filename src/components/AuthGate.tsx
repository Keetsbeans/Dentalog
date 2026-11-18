import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Perm, Role } from "../../shared/roles";

export type Me = { user: { id: string; name: string; email: string; role: Role; qualification: string | null }; perms: Perm[] };
type MeCtx = Me & { can: (p: Perm) => boolean; reload: () => Promise<void> };
const Ctx = createContext<MeCtx | null>(null);

/** The signed-in person and what they may do. */
export function useMe(): MeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe outside AuthGate");
  return v;
}

type State = { kind: "checking" } | { kind: "in"; me: Me } | { kind: "out"; firstRun: boolean } | { kind: "not_set_up" };

/** Shows the sign-in screen until someone signs in on this device. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  async function check() {
    try {
      const r = await fetch("/api/me");
      const body = await r.json().catch(() => ({}));
      if (r.ok) setState({ kind: "in", me: body as Me });
      else if (r.status === 503) setState({ kind: "not_set_up" });
      else setState({ kind: "out", firstRun: !!(body as { firstRun?: boolean }).firstRun });
    } catch { setState({ kind: "out", firstRun: false }); }
  }
  useEffect(() => {
    check();
    const out = () => check();
    window.addEventListener("dentalog:signed-out", out);
    return () => window.removeEventListener("dentalog:signed-out", out);
  }, []);
  if (state.kind === "checking") return null;
  if (state.kind === "in") {
    const me = state.me;
    return <Ctx.Provider value={{ ...me, can: (p) => me.perms.includes(p), reload: check }}>{children}</Ctx.Provider>;
  }
  return <SignIn notSetUp={state.kind === "not_set_up"} firstRun={state.kind === "out" && state.firstRun} onIn={check} />;
}

type Mode = "signin" | "setup" | "forgot";

function SignIn({ notSetUp, firstRun, onIn }: { notSetUp: boolean; firstRun: boolean; onIn: () => void }) {
  const [mode, setMode] = useState<Mode>(firstRun ? "setup" : "signin");
  const [f, setF] = useState({ email: "", password: "", password2: "", name: "", qualification: "", clinicPassword: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr("");
    if (mode !== "signin" && f.password !== f.password2) return setErr("The two new passwords don’t match.");
    setBusy(true);
    try {
      if (mode === "signin") await api("/login", { method: "POST", body: JSON.stringify({ email: f.email, password: f.password }) });
      if (mode === "setup") await api("/setup", { method: "POST", body: JSON.stringify(f) });
      if (mode === "forgot") await api("/reset-owner", { method: "POST", body: JSON.stringify({ email: f.email, password: f.password, clinicPassword: f.clinicPassword }) });
      onIn();
    } catch (e) { setErr((e as Error).message); setF({ ...f, password: mode === "signin" ? "" : f.password }); }
    finally { setBusy(false); }
  }

  const pw = (label: string, k: "password" | "password2" | "clinicPassword", auto: string) => (
    <label className="field">{label}<input className="input" type={show ? "text" : "password"} autoComplete={auto} value={f[k]} onChange={set(k)} /></label>
  );

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-row"><img src="/icon.svg" alt="" width={44} height={44} /><span className="brand-name">Dentalog</span></div>
        <div className="clinic-row"><img src="/clinic-logo.png" alt="" width={22} height={22} /><span>Oyster Dental Care</span></div>
        {notSetUp ? (
          <p className="warn">The clinic password hasn’t been set yet. Add a secret called DENTALOG_PASSWORD in Cloudflare (your Worker → Settings → Variables and secrets), then reload this page.</p>
        ) : (
          <>
            {mode === "setup" && <p className="note"><b>Set up your own login.</b> Enter the clinic password once to prove it’s you, then choose the email and password you’ll sign in with from now on.</p>}
            {mode === "forgot" && <p className="note">For the clinic owner: enter the clinic password from Cloudflare and choose a new password. Staff who forget theirs should ask the owner.</p>}
            {mode === "setup" && <>
              <label className="field">Your name<input className="input" autoComplete="name" value={f.name} onChange={set("name")} placeholder="Dr Soosi Christopher" /></label>
              <label className="field">Qualification<input className="input" value={f.qualification} onChange={set("qualification")} placeholder="BDS" /></label>
            </>}
            <label className="field">Email<input className="input" type="email" autoComplete="username" autoFocus={mode === "signin"} value={f.email} onChange={set("email")} /></label>
            {mode === "signin" ? pw("Password", "password", "current-password") : <>
              {pw("Clinic password", "clinicPassword", "off")}
              {pw("New password (8 or more characters)", "password", "new-password")}
              {pw("New password again", "password2", "new-password")}
            </>}
            <label className="check small"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
            {err && <p className="error" role="alert">{err}</p>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "setup" ? "Create my login" : "Set new password"}</button>
            {mode === "signin" && <button type="button" className="link-btn" onClick={() => { setMode("forgot"); setErr(""); }}>Forgot your password?</button>}
            {mode === "forgot" && <button type="button" className="link-btn" onClick={() => { setMode("signin"); setErr(""); }}>Back to sign in</button>}
            <p className="muted">This device stays signed in for 30 days.</p>
          </>
        )}
      </form>
    </main>
  );
}

export async function signOut() {
  await fetch("/api/logout", { method: "POST" });
  window.dispatchEvent(new Event("dentalog:signed-out"));
}
