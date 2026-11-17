import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, type Patient } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

const ALERTS = ["Diabetic", "BP", "Blood thinners", "Penicillin allergy", "Other allergy", "Pregnant", "Heart condition"];

export function Patients() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Patient[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<Patient | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  async function confirmDelete() {
    const p = toDelete!;
    setToDelete(null);
    try {
      await api(`/patients/${p.id}`, { method: "DELETE" });
      setRows((r) => r?.filter((x) => x.id !== p.id) ?? null);
      toast({
        title: `“${p.name} (${p.code})” deleted`,
        sub: "Patient record · moving to Recently deleted",
        onUndo: async () => {
          await api(`/trash/patient/${p.id}/restore`, { method: "POST" });
          toast({ title: `${p.name} is back, with all their records.` });
          load();
        },
      });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="page-head">
        <h1>Patients</h1>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>Add patient</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <label className="sr-only" htmlFor="psearch">Search patients</label>
        <input id="psearch" className="input search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, patient ID, file no. or mobile" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Patient</th><th>Mobile</th><th>Alerts</th><th><span className="sr-only">Delete</span></th></tr></thead>
            <tbody>
              {rows?.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/patients/${p.id}`} className="plain"><b>{p.name}</b></Link><div className="muted">{p.code}{p.fileNo ? ` · ${p.fileNo}` : ""}</div></td>
                  <td className="nums">+91 {p.phone.slice(0, 5)} {p.phone.slice(5)}</td>
                  <td>{p.alerts.map((a) => <span key={a} className="tag alert">{a}</span>)}</td>
                  <td className="right">
                    <button type="button" className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && rows.length === 0 && <p className="empty">{q ? "No patients match. Check the spelling or try the mobile number." : "No patients yet. Add your first one."}</p>}
          {!rows && !error && <p className="empty">Loading…</p>}
        </div>
      </div>

      {adding && <AddPatient onClose={() => setAdding(false)} onSaved={(msg) => { setAdding(false); toast({ title: msg }); load(); }} />}

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.name ?? ""}?`}
        confirmLabel="Delete patient"
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      >
        {toDelete?.code}{toDelete?.fileNo ? ` · ${toDelete.fileNo}` : ""}. Their visits, notes, X-rays, prescriptions and receipts are moved with them.
      </ConfirmDialog>
    </>
  );
}

function AddPatient({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"F" | "M" | "O">("F");
  const [alerts, setAlerts] = useState<string[]>([]);
  const [err, setErr] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ code: string }>("/patients", { method: "POST", body: JSON.stringify({ name, phone, gender, alerts }) });
      onSaved(`${name.trim()} added as ${r.code}.`);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="overlay">
      <form className="dialog open" onSubmit={save} aria-labelledby="add-title">
        <h2 id="add-title">Add patient</h2>
        <label className="field">Full name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field">Mobile (WhatsApp)<input className="input" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 digits" /></label>
        <label className="field">Gender
          <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "F" | "M" | "O")}>
            <option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
          </select>
        </label>
        <fieldset className="field"><legend>Medical alerts</legend>
          <div className="chips">
            {ALERTS.map((a) => {
              const on = alerts.includes(a);
              return <button key={a} type="button" aria-pressed={on} className={"chip" + (on ? " on" : "")} onClick={() => setAlerts(on ? alerts.filter((x) => x !== a) : [...alerts, a])}>{a}</button>;
            })}
          </div>
        </fieldset>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save patient</button>
        </div>
      </form>
    </div>
  );
}
