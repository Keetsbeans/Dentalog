import { useCallback, useEffect, useState } from "react";
import { api, type InvoiceSummary } from "../lib/api";
import { useToast } from "../components/Toast";
import { BillDialog, NewBill, printReceipt } from "../components/Billing";
import { dayLabel } from "../components/Appointments";
import { rupees } from "../../shared/money";
import { todayIst, utcToIst } from "../../shared/time";

type Filter = "all" | "due" | "today";

export function Billing() {
  const toast = useToast();
  const [rows, setRows] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api<InvoiceSummary[]>("/invoices")); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = todayIst();
  const ql = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) =>
    (filter === "all" || (filter === "due" ? r.balancePaise > 0 : utcToIst(r.issuedAt).day === today)) &&
    (!ql || `${r.number} ${r.patient.name} ${r.patient.code} ${r.patient.phone}`.toLowerCase().includes(ql)));
  const todays = (rows ?? []).filter((r) => utcToIst(r.issuedAt).day === today);
  const due = (rows ?? []).reduce((a, r) => a + r.balancePaise, 0);

  return (
    <>
      <div className="page-head">
        <h1>Billing</h1>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>New bill</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="stats">
        <div className="stat"><b className="nums">{rupees(todays.reduce((a, r) => a + r.totalPaise, 0))}</b><span>Billed today</span></div>
        <div className="stat"><b className="nums">{rupees(todays.reduce((a, r) => a + r.paidPaise, 0))}</b><span>Collected on today’s bills</span></div>
        <div className="stat"><b className={"nums" + (due > 0 ? " due" : "")}>{rupees(due)}</b><span>Balance due, all bills</span></div>
      </div>
      <div className="card">
        <div className="toolbar">
          <label className="sr-only" htmlFor="bsearch">Search bills</label>
          <input id="bsearch" className="input search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bill no., patient or mobile" />
          <div className="seg" role="group" aria-label="Show">
            {([["all", "All"], ["due", "Balance due"], ["today", "Today"]] as [Filter, string][]).map(([f, l]) =>
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>)}
          </div>
        </div>
        <div className="table-wrap">
          <table className="bills">
            <thead><tr><th>Bill</th><th>Patient</th><th className="right">Total</th><th className="right hide-sm">Paid</th><th className="right">Balance</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                  <td><button type="button" className="plain-btn" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}><b>{r.number}</b></button><div className="muted">{dayLabel(utcToIst(r.issuedAt).day, { day: "numeric", month: "short", year: "numeric" })}</div></td>
                  <td><b>{r.patient.name}</b><div className="muted">{r.patient.code}</div></td>
                  <td className="right nums">{rupees(r.totalPaise)}</td>
                  <td className="right nums hide-sm">{rupees(r.paidPaise)}</td>
                  <td className={"right nums" + (r.balancePaise > 0 ? " due" : "")}>{r.balancePaise > 0 ? rupees(r.balancePaise) : "Nil"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && shown.length === 0 && <p className="empty">{rows.length ? "No bills match." : "No bills yet. Make the first one with New bill."}</p>}
          {!rows && !error && <p className="empty">Loading…</p>}
        </div>
      </div>
      {adding && <NewBill onClose={() => setAdding(false)} onSaved={(msg, receiptId) => {
        setAdding(false); load();
        toast({ title: msg, sub: receiptId ? "Opening the receipt to print" : undefined });
        if (receiptId) printReceipt(receiptId);
      }} />}
      {open && <BillDialog id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
