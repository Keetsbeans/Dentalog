import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, type LabOrder, type Patient } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toPaise } from "../components/Billing";
import { dayLabel } from "../components/Appointments";
import { rupees } from "../../shared/money";
import { addDays, todayIst } from "../../shared/time";
import { formatPhone } from "../../shared/phone";
import { useMe } from "../components/AuthGate";

type Filter = "open" | "late" | "unpaid" | "all";
const STATUS: Record<LabOrder["status"], string> = { sent: "At the lab", received: "Back, to fit", fitted: "Fitted" };
const NEXT: Partial<Record<LabOrder["status"], [LabOrder["status"], string]>> = { sent: ["received", "Mark received"], received: ["fitted", "Mark fitted"] };
const short = (d: string) => dayLabel(d, { day: "numeric", month: "short" });

export function LabOrders() {
  const { can } = useMe();
  const toast = useToast();
  const [rows, setRows] = useState<LabOrder[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<LabOrder | null>(null);
  const [toDelete, setToDelete] = useState<LabOrder | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api<LabOrder[]>("/lab-orders")); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = todayIst();
  const all = rows ?? [];
  const late = (o: LabOrder) => o.status === "sent" && o.dueOn < today;
  const owed = (o: LabOrder) => o.billPaise - o.paidPaise;
  const shown = all.filter((o) => filter === "all" || (filter === "open" ? o.status !== "fitted" : filter === "late" ? late(o) : owed(o) > 0));
  const byLab = Object.entries(all.reduce<Record<string, { open: number; owe: number; bills: number[] }>>((acc, o) => {
    const l = (acc[o.lab] ??= { open: 0, owe: 0, bills: [] });
    if (o.status !== "fitted") l.open++;
    l.owe += owed(o);
    if (o.billPaise > 0) l.bills.push(o.billPaise);
    return acc;
  }, {}));

  async function step(o: LabOrder) {
    const n = NEXT[o.status]; if (!n) return;
    try {
      await api(`/lab-orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: n[0] }) });
      load();
      toast({ title: `${o.number} · ${o.work}: ${STATUS[n[0]]}`, onUndo: async () => { await api(`/lab-orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: o.status }) }); load(); } });
    } catch (e) { setError((e as Error).message); }
  }

  async function remove() {
    const o = toDelete!; setToDelete(null);
    try {
      await api(`/lab-orders/${o.id}`, { method: "DELETE" });
      load();
      toast({ title: `“${o.number} · ${o.work}” deleted`, sub: "Lab order · moving to Recently deleted", onUndo: async () => { await api(`/trash/lab/${o.id}/restore`, { method: "POST" }); load(); } });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Lab orders</h1><p className="muted">Crowns, bridges, dentures and appliances sent to dental labs</p></div>
        {can("lab.write") && <button type="button" className="btn primary" onClick={() => setAdding(true)}>New lab order</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="stats">
        <div className="stat"><b>{all.filter((o) => o.status === "sent").length}</b><span>At the lab</span></div>
        <div className="stat"><b className={all.some(late) ? "due" : ""}>{all.filter(late).length}</b><span>Overdue</span></div>
        <div className="stat"><b>{all.filter((o) => o.status === "received").length}</b><span>Back, waiting to fit</span></div>
        <div className="stat"><b className="nums">{rupees(all.reduce((a, o) => a + owed(o), 0))}</b><span>We owe labs</span></div>
      </div>
      <div className="visit-grid wide-left">
        <div className="card">
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Show">
              {([["open", "Open"], ["late", "Overdue"], ["unpaid", "Lab unpaid"], ["all", "All"]] as [Filter, string][]).map(([f, l]) =>
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>)}
            </div>
          </div>
          <ul className="list">
            {shown.map((o) => (
              <li key={o.id} className="lab-item">
                <div className="lab-main">
                  <span><b>{o.work}</b>{o.tooth ? <span className="muted"> · tooth {o.tooth}</span> : ""}{o.shade ? <span className="muted"> · shade {o.shade}</span> : ""}</span>
                  <span className="q-sub"><Link to={`/patients/${o.patient.id}`}>{o.patient.name}</Link> · {o.number} · {o.lab}</span>
                  <span className={"q-sub" + (late(o) ? " due" : "")}>Sent {short(o.sentOn)} → due {short(o.dueOn)}{late(o) ? " · overdue" : ""}</span>
                  <span className="q-sub">Lab bill {o.billPaise ? rupees(o.billPaise) : "not entered"}{owed(o) > 0 ? ` · ${rupees(owed(o))} to pay` : o.billPaise ? " · paid" : ""}</span>
                </div>
                <div className="lab-actions">
                  <span className={"pill " + (o.status === "fitted" ? "s-done" : o.status === "received" ? "s-arrived" : late(o) ? "s-no_show" : "s-booked")}>{STATUS[o.status]}</span>
                  {NEXT[o.status] && <button type="button" className="btn small primary" onClick={() => step(o)}>{NEXT[o.status]![1]}</button>}
                  {can("lab.write") && (owed(o) > 0 || !o.billPaise) && <button type="button" className="btn small" onClick={() => setPaying(o)}>{o.billPaise ? "Pay lab" : "Enter bill"}</button>}
                  {can("delete") && <button type="button" className="icon-btn" aria-label={`Delete ${o.number}`} onClick={() => setToDelete(o)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                  </button>}
                </div>
              </li>
            ))}
          </ul>
          {rows && shown.length === 0 && <p className="empty">{all.length ? "Nothing here right now." : "No lab orders yet."}</p>}
          {!rows && !error && <p className="empty">Loading…</p>}
        </div>
        <section className="card">
          <h2>By lab</h2>
          {byLab.length === 0 && <p className="empty">Labs appear here after the first order.</p>}
          <ul className="list">
            {byLab.map(([name, l]) => (
              <li key={name} className="list-row"><span><b>{name}</b><span className="q-sub">{l.open} open · average bill {l.bills.length ? rupees(Math.round(l.bills.reduce((a, b) => a + b, 0) / l.bills.length)) : "–"}</span></span>
                <span className={"nums" + (l.owe > 0 ? " due" : "")}>{l.owe > 0 ? `We owe ${rupees(l.owe)}` : "Settled"}</span></li>
            ))}
          </ul>
        </section>
      </div>

      {adding && <NewLabOrder onClose={() => setAdding(false)} onSaved={(msg) => { setAdding(false); toast({ title: msg }); load(); }} />}
      {paying && <PayLab order={paying} onClose={() => setPaying(null)} onSaved={(msg) => { setPaying(null); toast({ title: msg }); load(); }} />}
      <ConfirmDialog open={!!toDelete} title={`Delete lab order ${toDelete?.number ?? ""}?`} confirmLabel="Delete order" onCancel={() => setToDelete(null)} onConfirm={remove}>
        {toDelete?.work} for {toDelete?.patient.name}, {toDelete?.lab}.
      </ConfirmDialog>
    </>
  );
}

function NewLabOrder({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const { settings } = useClinic();
  const today = todayIst();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lab, setLab] = useState(settings.labs[0]?.name ?? "");
  const [work, setWork] = useState("");
  const [tooth, setTooth] = useState("");
  const [shade, setShade] = useState("");
  const [sentOn, setSentOn] = useState(today);
  const labDays = settings.labs.find((l) => l.name === lab)?.days ?? 7;
  const [dueOn, setDueOn] = useState(addDays(today, labDays));
  const [bill, setBill] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (patient || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`).then((r) => setFound(r.slice(0, 6))).catch(() => setFound([])), 200);
    return () => clearTimeout(t);
  }, [q, patient]);

  const pickLab = (name: string) => { setLab(name); setDueOn(addDays(sentOn, settings.labs.find((l) => l.name === name)?.days ?? 7)); };

  async function save(e: FormEvent) {
    e.preventDefault(); setErr("");
    if (!patient) { setErr("Choose a patient."); return; }
    try {
      const r = await api<{ number: string }>("/lab-orders", { method: "POST", body: JSON.stringify({ patientId: patient.id, lab, work, tooth, shade, sentOn, dueOn, billPaise: toPaise(bill) ?? 0 }) });
      onSaved(`${r.number} · ${work} sent to ${lab}. Due ${short(dueOn)}.`);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open wide" onSubmit={save} aria-labelledby="lab-title">
        <h2 id="lab-title">New lab order</h2>
        {patient ? (
          <div className="picked"><div><b>{patient.name}</b> <span className="muted">{patient.code}</span></div><button type="button" className="btn small" onClick={() => { setPatient(null); setQ(""); }}>Change</button></div>
        ) : (
          <div className="field">
            <label htmlFor="lab-q">Patient</label>
            <input id="lab-q" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, patient ID or mobile" autoComplete="off" />
            {found.length > 0 && <ul className="picklist">{found.map((p) => <li key={p.id}><button type="button" onClick={() => setPatient(p)}><b>{p.name}</b> <span className="muted">{p.code} · {formatPhone(p.phoneCc, p.phone)}</span></button></li>)}</ul>}
          </div>
        )}
        <fieldset className="field"><legend>Lab</legend>
          <div className="chips">{settings.labs.map((l) => <button key={l.name} type="button" aria-pressed={lab === l.name} className={"chip teal" + (lab === l.name ? " on" : "")} onClick={() => pickLab(l.name)}>{l.name}</button>)}</div>
          {settings.labs.length === 0 && <span className="muted">Add your labs in Settings → Dental labs.</span>}
        </fieldset>
        <fieldset className="field"><legend>Work</legend>
          <div className="chips">{settings.labWork.map((w) => <button key={w} type="button" aria-pressed={work === w} className={"chip teal" + (work === w ? " on" : "")} onClick={() => setWork(w)}>{w}</button>)}</div>
          <input className="input" value={work} onChange={(e) => setWork(e.target.value)} placeholder="Or type the work" />
        </fieldset>
        <div className="row2">
          <label className="field">Tooth<input className="input" value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder="e.g. 36" /></label>
          <label className="field">Shade<input className="input" value={shade} onChange={(e) => setShade(e.target.value)} placeholder="e.g. A2" /></label>
          <label className="field">Sent on<input type="date" className="input" value={sentOn} onChange={(e) => { setSentOn(e.target.value); setDueOn(addDays(e.target.value, labDays)); }} /></label>
          <label className="field">Due back<input type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
          <label className="field">Lab bill (₹, if known)<input className="input nums" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} /></label>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save order</button>
        </div>
      </form>
    </div>
  );
}

function PayLab({ order: o, onClose, onSaved }: { order: LabOrder; onClose: () => void; onSaved: (msg: string) => void }) {
  const [bill, setBill] = useState(o.billPaise ? String(o.billPaise / 100) : "");
  const billPaise = toPaise(bill) ?? 0;
  const [pay, setPay] = useState(o.billPaise ? String((o.billPaise - o.paidPaise) / 100) : "");
  const [err, setErr] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); setErr("");
    const payPaise = toPaise(pay) ?? 0;
    try {
      await api(`/lab-orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ ...(billPaise !== o.billPaise ? { billPaise } : {}), ...(payPaise > 0 ? { payPaise } : {}) }) });
      onSaved(payPaise > 0 ? `Paid ${rupees(payPaise)} to ${o.lab} for ${o.number}.` : `Lab bill for ${o.number} saved.`);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open" onSubmit={save} aria-labelledby="pay-title">
        <h2 id="pay-title">{o.number} · {o.work}</h2>
        <p className="muted">{o.lab} · {o.patient.name}{o.paidPaise ? ` · ${rupees(o.paidPaise)} paid so far` : ""}</p>
        <div className="row2">
          <label className="field">Lab bill (₹)<input className="input nums" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} /></label>
          <label className="field">Paying now (₹)<input className="input nums" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="0" /></label>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}
