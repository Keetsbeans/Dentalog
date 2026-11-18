import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Patient } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { PatientForm } from "../components/PatientForm";
import { formatPhone } from "../../shared/phone";
import { useMe } from "../components/AuthGate";


export function Patients() {
  const { can } = useMe();
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
                  <td className="nums">{formatPhone(p.phoneCc, p.phone)}</td>
                  <td>{p.alerts.map((a) => <span key={a} className="tag alert">{a}</span>)}</td>
                  <td className="right">
                    {can("delete") && <button type="button" className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && rows.length === 0 && <p className="empty">{q ? "No patients match. Check the spelling or try the mobile number." : "No patients yet. Add your first one."}</p>}
          {!rows && !error && <p className="empty">Loading…</p>}
        </div>
      </div>

      {adding && <PatientForm onClose={() => setAdding(false)} onSaved={(msg) => { setAdding(false); toast({ title: msg }); load(); }} />}

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
