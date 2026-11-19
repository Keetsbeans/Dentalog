import { useState } from "react";
import { api, type Addendum } from "../lib/api";
import { dayLabel } from "./Appointments";
import { label12, utcToIst } from "../../shared/time";

/** Dated additions under a signed visit note. */
export function Addenda({ visitId, items, onAdded, readOnly }: { visitId: string; items: Addendum[]; onAdded: (a: Addendum) => void; readOnly?: boolean }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true); setErr("");
    try { onAdded(await api<Addendum>(`/visits/${visitId}/addenda`, { method: "POST", body: JSON.stringify({ text }) })); setText(""); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="card addenda">
      <h2>Addenda</h2>
      <p className="muted">The signed note stays as it was. Anything you add here is dated and shown under it.</p>
      {items.length > 0 && (
        <ul className="history">
          {items.map((a) => {
            const t = utcToIst(a.createdAt);
            return <li key={a.id}><span className="muted">{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}, {label12(t.time)}</span>{a.text}</li>;
          })}
        </ul>
      )}
      {!readOnly && <>
      <label className="field">New addendum<textarea className="input area" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Patient called: pain settled, continue medicines." /></label>
      {err && <p className="error" role="alert">{err}</p>}
      <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={add}>{busy ? "Adding…" : "Add addendum"}</button>
      </>}
    </section>
  );
}
