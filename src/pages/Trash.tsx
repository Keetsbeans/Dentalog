import { useEffect, useState } from "react";
import { api, type TrashItem } from "../lib/api";
import { useToast } from "../components/Toast";

const TYPE: Record<TrashItem["kind"], string> = {
  patient: "Patient", appointment: "Appointment", visit: "Visit note", invoice: "Invoice",
  receipt: "Receipt", lab: "Lab order", file: "File / X-ray",
};

export function Trash() {
  const toast = useToast();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState("");
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [sure, setSure] = useState(false);

  const load = () => api<TrashItem[]>("/trash").then(setItems).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function restore(it: TrashItem) {
    await api(`/trash/${it.kind}/${it.id}/restore`, { method: "POST" });
    toast({ title: `${it.title} restored.` });
    load();
  }
  async function purge() {
    const it = purging!;
    setPurging(null);
    await api(`/trash/${it.kind}/${it.id}`, { method: "DELETE" });
    toast({ title: `${it.title} deleted permanently.` });
    load();
  }

  return (
    <>
      <h1>Recently deleted</h1>
      <p className="muted">Everything you delete waits here for 30 days, then is removed for good. Restoring puts it back where it was.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>What was deleted</th><th>Type</th><th>Reason</th><th>Removed for good</th><th className="right">Action</th></tr></thead>
            <tbody>
              {items?.map((it) => (
                <tr key={it.kind + it.id}>
                  <td><b>{it.title}</b><div className="muted">{it.detail}</div></td>
                  <td><span className="tag">{TYPE[it.kind]}</span></td>
                  <td className="muted">{it.reason ?? "—"}</td>
                  <td className={it.daysLeft <= 3 ? "soon" : ""}>{it.daysLeft <= 1 ? "Tonight or tomorrow" : `In ${it.daysLeft} days`}</td>
                  <td className="right nowrap">
                    <button type="button" className="btn small" onClick={() => restore(it)}>Restore</button>{" "}
                    <button type="button" className="btn small danger-outline" onClick={() => { setSure(false); setPurging(it); }}>Delete now</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items && items.length === 0 && <p className="empty">Nothing here. Anything you delete will wait here for 30 days.</p>}
        </div>
      </div>
      {purging && (
        <div className="overlay">
          <div className="dialog open" role="alertdialog" aria-modal="true" aria-labelledby="purge-title">
            <h2 id="purge-title">Delete permanently?</h2>
            <p>{purging.title} will be removed for good.</p>
            <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this can’t be undone</label>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setPurging(null)}>Cancel</button>
              <button type="button" className="btn danger" disabled={!sure} onClick={purge}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
