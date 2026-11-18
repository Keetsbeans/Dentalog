import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";

type State = "checking" | "in" | "out" | "not_set_up";

/** Shows the sign-in screen until the clinic password is entered on this device. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  useEffect(() => {
    fetch("/api/me").then((r) => setState(r.ok ? "in" : r.status === 503 ? "not_set_up" : "out")).catch(() => setState("out"));
    const out = () => setState("out");
    window.addEventListener("dentalog:signed-out", out);
    return () => window.removeEventListener("dentalog:signed-out", out);
  }, []);
  if (state === "checking") return null;
  if (state === "in") return <>{children}</>;
  return <Login notSetUp={state === "not_set_up"} onIn={() => setState("in")} />;
}

function Login({ notSetUp, onIn }: { notSetUp: boolean; onIn: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api("/login", { method: "POST", body: JSON.stringify({ password }) }); onIn(); }
    catch (e) { setErr((e as Error).message); setPassword(""); }
    finally { setBusy(false); }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-row"><img src="/icon.svg" alt="" width={44} height={44} /><span className="brand-name">Dentalog</span></div>
        <div className="clinic-row"><img src="/clinic-logo.png" alt="" width={22} height={22} /><span>Oyster Dental Care</span></div>
        {notSetUp ? (
          <p className="warn">The clinic password hasn’t been set yet. Add a secret called DENTALOG_PASSWORD in Cloudflare (your Worker → Settings → Variables and secrets), then reload this page.</p>
        ) : (
          <>
            <label className="field">Clinic password
              <input className="input" type={show ? "text" : "password"} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="check small"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
            {err && <p className="error" role="alert">{err}</p>}
            <button type="submit" className="btn primary" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
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
