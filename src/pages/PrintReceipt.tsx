import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, type Invoice, type Patient, type Receipt } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { dayLabel } from "../components/Appointments";
import { MODE_LABEL } from "../components/Billing";
import { rupees } from "../../shared/money";
import { label12, utcToIst } from "../../shared/time";
import { formatPhone } from "../../shared/phone";

type Data = { receipt: Receipt; patient: Patient; invoice: Invoice | null; inWords: string };

/** A4 payment receipt on the clinic letterhead. */
export function PrintReceipt() {
  const { id } = useParams();
  const { clinic } = useClinic();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Data>(`/receipts/${id}`).then(setD).catch((e) => setError((e as Error).message)); }, [id]);
  useEffect(() => { document.title = d ? `Receipt ${d.receipt.number} · ${d.patient.name}` : "Receipt"; }, [d]);

  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>;
  if (!d) return <p className="empty">Loading…</p>;
  const { receipt: r, patient: p, invoice: inv } = d;
  const t = utcToIst(r.receivedAt);
  const doctor = clinic?.doctorName ?? "Dr Soosi Christopher";
  const earlier = inv ? inv.receipts.filter((x) => x.receivedAt < r.receivedAt).reduce((a, x) => a + x.amountPaise, 0) : 0;
  const balanceAfter = inv ? inv.totalPaise - earlier - r.amountPaise : 0;

  return (
    <div className="print-wrap">
      <div className="print-bar no-print"><button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button></div>
      <article className="a4">
        <header className="a4-head">
          <img src="/letterhead.jpg" alt={`${clinic?.name ?? "Oyster Dental Care"} letterhead`} />
          <div className="a4-doc"><b>{doctor}</b>{clinic?.qualification ? `, ${clinic.qualification}` : ""}</div>
        </header>
        <div className="a4-body">
          <div className="a4-title">
            <div><span className="a4-big">RECEIPT</span><div>No. <b>{r.number}</b>{inv ? ` · for bill ${inv.number}` : ""}</div></div>
            <div className="right">{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}<br />{label12(t.time)}</div>
          </div>
          <div className="a4-box">
            <span>Received from</span><b>{p.name}</b>
            <span>Patient ID</span><span>{p.code}{p.fileNo ? ` · File ${p.fileNo}` : ""}</span>
            <span>Mobile</span><span>{formatPhone(p.phoneCc, p.phone)}</span>
          </div>
          {inv && (
            <table className="a4-rx">
              <thead><tr><th>Service</th><th>Tooth</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l) => <tr key={l.id}><td>{l.service}</td><td>{l.tooth ?? ""}</td><td className="right nums">{rupees(l.amountPaise)}</td></tr>)}
                <tr><td colSpan={2} className="soft">Total</td><td className="right nums">{rupees(inv.totalPaise + inv.discountPaise)}</td></tr>
                {inv.discountPaise > 0 && <tr><td colSpan={2} className="soft">Discount</td><td className="right nums">– {rupees(inv.discountPaise)}</td></tr>}
                {earlier > 0 && <tr><td colSpan={2} className="soft">Paid earlier</td><td className="right nums">– {rupees(earlier)}</td></tr>}
              </tbody>
            </table>
          )}
          <div className="a4-received"><span>Amount received</span><b className="nums">{rupees(r.amountPaise)}</b></div>
          {inv && <div className="a4-balance"><span>Balance due</span><b>{balanceAfter > 0 ? rupees(balanceAfter) : "Nil"}</b></div>}
          <div className="a4-sec">
            <span><b>In words:</b> {d.inWords}</span>
            <span><b>Paid by:</b> {MODE_LABEL[r.mode]}{r.reference ? ` · ref. ${r.reference}` : ""}</span>
          </div>
          <div className="a4-foot-row">
            {clinic?.upiId ? <div className="a4-next"><span className="a4-label teal">PAY A BALANCE BY UPI</span><b>{clinic.upiId}</b></div> : <span />}
            <div className="a4-sign"><div className="line" /><b>{doctor}</b><span>Signature &amp; stamp</span></div>
          </div>
        </div>
        <footer className="a4-foot"><span>Thank you. Keep this receipt for insurance claims.</span><span>Made with Dentalog</span></footer>
      </article>
    </div>
  );
}
