import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, startVisit, type InvoiceSummary, type Patient, type Visit } from "../lib/api";
import { useToast } from "../components/Toast";
import { BillDialog, NewBill, printReceipt } from "../components/Billing";
import { rupees } from "../../shared/money";
import { dayLabel, STATUS_LABEL } from "../components/Appointments";
import { label12, utcToIst } from "../../shared/time";
import type { ApptStatus } from "../lib/api";

type Record_ = {
  patient: Patient & { notes: string | null };
  visits: Visit[];
  appointments: { id: string; startsAt: string; minutes: number; visitType: string; status: ApptStatus; notes: string | null }[];
};

export function PatientRecord() {
  const { id } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState<Record_ | null>(null);
  const [error, setError] = useState("");
  const [bills, setBills] = useState<InvoiceSummary[]>([]);
  const [billing, setBilling] = useState(false);
  const [openBill, setOpenBill] = useState<string | null>(null);
  const toast = useToast();
  const loadBills = () => api<InvoiceSummary[]>(`/invoices?patientId=${id}`).then(setBills).catch(() => setBills([]));
  useEffect(() => { api<Record_>(`/patients/${id}`).then(setR).catch((e) => setError((e as Error).message)); loadBills(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!r) return <p className="empty">Loading…</p>;
  const p = r.patient;
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const now = new Date().toISOString();
  const upcoming = r.appointments.filter((a) => a.startsAt >= now && a.status === "booked").reverse();

  async function newVisit() {
    try { nav(`/visits/${await startVisit(p.id)}`); } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link to="/patients">Patients</Link> · {p.code}{p.fileNo ? ` · File ${p.fileNo}` : ""}</p>
          <h1>{p.name}</h1>
          <span className="muted">{[p.gender === "F" ? "Female" : p.gender === "M" ? "Male" : p.gender ? "Other" : null, age ? `${age} yrs` : null, `+91 ${p.phone.slice(0, 5)} ${p.phone.slice(5)}`].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => setBilling(true)}>New bill</button>
          <button type="button" className="btn primary" onClick={newVisit}>Start visit note</button>
        </div>
      </div>
      {p.alerts.length > 0 && <div className="alert-bar" role="note"><b>Medical alerts:</b> {p.alerts.join(" · ")}</div>}

      <div className="visit-grid">
        <section className="card">
          <h2>Visits</h2>
          {r.visits.length === 0 && <p className="empty">No visit notes yet.</p>}
          <ul className="list">
            {r.visits.map((v) => {
              const t = utcToIst(v.createdAt);
              return (
                <li key={v.id}>
                  <Link to={`/visits/${v.id}`} className="list-row">
                    <span>
                      <b>{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}</b>
                      {v.tooth ? ` · Tooth ${v.tooth}` : ""}
                      <span className="q-sub">{[v.diagnosis.join(", "), v.complaint].filter(Boolean).join(" · ") || "No details yet"}</span>
                    </span>
                    <span className={"pill " + (v.signedAt ? "s-done" : "s-arrived")}>{v.signedAt ? "Signed" : "Draft"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="card">
          <h2>Bills {bills.some((b) => b.balancePaise > 0) && <span className="pill s-no_show">{rupees(bills.reduce((a, b) => a + b.balancePaise, 0))} due</span>}</h2>
          {bills.length === 0 && <p className="empty">No bills yet.</p>}
          <ul className="list">
            {bills.map((b) => (
              <li key={b.id}><button type="button" className="list-row plain-btn wide-btn" onClick={() => setOpenBill(b.id)}>
                <span><b>{b.number}</b> · {dayLabel(utcToIst(b.issuedAt).day, { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className={"nums" + (b.balancePaise > 0 ? " due" : "")}>{rupees(b.totalPaise)}{b.balancePaise > 0 ? ` · ${rupees(b.balancePaise)} due` : " · paid"}</span>
              </button></li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Coming up</h2>
          {upcoming.length === 0 && <p className="empty">Nothing booked. <Link to="/calendar">Book from the calendar</Link>.</p>}
          <ul className="list">
            {upcoming.map((a) => {
              const t = utcToIst(a.startsAt);
              return <li key={a.id} className="list-row"><span><b>{dayLabel(t.day)}, {label12(t.time)}</b><span className="q-sub">{a.visitType}{a.notes ? ` · ${a.notes}` : ""}</span></span><span className={`pill s-${a.status}`}>{STATUS_LABEL[a.status]}</span></li>;
            })}
          </ul>
        </section>
      </div>
      {billing && <NewBill patient={p} onClose={() => setBilling(false)} onSaved={(msg, receiptId) => { setBilling(false); loadBills(); toast({ title: msg }); if (receiptId) printReceipt(receiptId); }} />}
      {openBill && <BillDialog id={openBill} onClose={() => setOpenBill(null)} onChanged={loadBills} />}
    </>
  );
}
