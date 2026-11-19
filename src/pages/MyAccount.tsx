import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useMe } from "../components/AuthGate";
import { useToast } from "../components/Toast";
import { ROLE_LABEL, type Perm } from "../../shared/roles";

const WHAT: [Perm, string][] = [
  ["clinical.write", "Write and sign visit notes, prescriptions and the tooth chart"],
  ["billing.take", "Make bills, take payments and print receipts"],
  ["billing.edit", "Give discounts and change bills"],
  ["money.totals", "See collections and reports"],
  ["messages.send", "Send WhatsApp messages and reminders"],
  ["delete", "Delete records"],
  ["settings", "Change settings and manage staff logins"],
];

/** Everyone's own page: who they are, what their login allows, and changing their password. */
export function MyAccount() {
  const { user, can } = useMe();
  const toast = useToast();
  const [f, setF] = useState({ current: "", password: "", password2: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setErr("");
    if (f.password !== f.password2) return setErr("The two new passwords don’t match.");
    setBusy(true);
    try { await api("/me/password", { method: "POST", body: JSON.stringify(f) }); setF({ current: "", password: "", password2: "" }); toast({ title: "Password changed", sub: "Other devices have been signed out." }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="page-head"><div><h1>{user.name}</h1><p className="eyebrow">{ROLE_LABEL[user.role]} · {user.email}</p></div></div>
      <div className="visit-grid">
        <section className="card stack">
          <h2>What your login can do</h2>
          <ul className="list channels">
            {WHAT.map(([p, label]) => <li key={p}><span>{label}</span><span className={"pill " + (can(p) ? "s-ok" : "s-done")}>{can(p) ? "Yes" : "No"}</span></li>)}
          </ul>
          {user.role !== "owner" && <p className="muted">To change this, ask the clinic owner.</p>}
        </section>
        <form className="card stack" onSubmit={save}>
          <h2>Change your password</h2>
          <label className="field">Current password<input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
          <label className="field">New password (8 or more characters)<input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <label className="field">New password again<input className="input" type="password" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <button type="submit" className="btn primary" disabled={busy || !f.current || !f.password}>{busy ? "Saving…" : "Change password"}</button>
        </form>
      </div>
    </>
  );
}
