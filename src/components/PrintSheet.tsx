import type { ReactNode } from "react";
import { imageUrl, type Clinic, type Invoice, type Patient, type Receipt, type VisitBundle } from "../lib/api";
import { dayLabel } from "./Appointments";
import { MODE_LABEL } from "./Billing";
import { rupees } from "../../shared/money";
import { label12, utcToIst } from "../../shared/time";
import { formatPhone } from "../../shared/phone";
import type { PrintLayout } from "../../shared/print";

/** The page itself: letterhead (or space for one), body, signature and footer, laid out from Settings → Printouts. */
function Sheet({ clinic, layout, children, signLeft, footLeft, by }: { clinic: Clinic | null; layout: PrintLayout; children: ReactNode; signLeft: ReactNode; footLeft: string; by?: VisitBundle["doctor"] }) {
  // A prescription another doctor signed carries their name; the saved signature image is only the clinic doctor's.
  const doctor = by?.name ?? clinic?.doctorName ?? "";
  const qual = by ? by.qualification : clinic?.qualification;
  const head = imageUrl(clinic, "letterhead");
  const sig = layout.signature === "image" && !by ? imageUrl(clinic, "signature") : null;
  const logo = imageUrl(clinic, "logo");
  return (
    <article className={`a4 paper-${layout.paper} accent-${layout.accent}`} style={{ paddingBottom: `${layout.bottomMm}mm` }}>
      {layout.header === "letterhead" && head && (
        <header className="a4-head">
          <img src={head} alt={`${clinic?.name ?? ""} letterhead`} />
          <div className="a4-doc"><b>{doctor}</b>{qual ? `, ${qual}` : ""}</div>
        </header>
      )}
      {layout.header === "blank" && <div className="a4-blank" style={{ height: `${layout.topMm}mm` }} aria-hidden="true" />}
      {layout.header === "simple" && (
        <header className="a4-simple">
          {logo && <img src={logo} alt="" />}
          <div>
            <b className="a4-clinic">{clinic?.name}</b>
            <span>{doctor}{qual ? `, ${qual}` : ""}</span>
            <span className="soft">{[clinic?.address, clinic?.phone].filter(Boolean).join(" · ")}</span>
          </div>
        </header>
      )}
      <div className="a4-body">
        {children}
        <div className="a4-foot-row">
          {signLeft}
          <div className="a4-sign">
            {sig ? <img src={sig} alt="Signature" /> : <div className="line" />}
            <b>{doctor}</b><span>Signature &amp; stamp</span>
          </div>
        </div>
      </div>
      <footer className="a4-foot"><span>{footLeft}</span><span>Made with Dentalog</span></footer>
    </article>
  );
}

/** Page size for printing, which can only be set from a style rule. */
export function PageSize({ layout }: { layout: PrintLayout }) {
  return <style>{`@page { size: ${layout.paper}; margin: 0; }`}</style>;
}

export function RxSheet({ data, clinic, layout }: { data: VisitBundle; clinic: Clinic | null; layout: PrintLayout }) {
  const { visit: v, patient: p, items } = data;
  const t = utcToIst(v.signedAt ?? v.createdAt);
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const dx = [v.tooth ? `Tooth ${v.tooth}` : "", v.diagnosis.join(", ")].filter(Boolean).join(": ");
  const advice = [...v.advice, v.adviceNote ?? ""].filter(Boolean);
  const S = layout.show;
  return (
    <Sheet clinic={clinic} layout={layout} footLeft={layout.footer} by={data.doctor}
      signLeft={S.next && v.nextVisit ? <div className="a4-next"><span className="a4-label teal">NEXT VISIT</span><b>{v.nextVisit}</b></div> : <span />}>
      <div className="a4-patient">
        <span><b className="big">{p.name}</b>{p.gender ? ` · ${p.gender}` : ""}{age ? `, ${age}` : ""}</span>
        <span className="right">{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}, {label12(t.time)}</span>
        <span>{p.code}{p.fileNo ? ` · File ${p.fileNo}` : ""}{S.phone ? ` · ${formatPhone(p.phoneCc, p.phone)}` : ""}</span>
      </div>
      {S.alerts && p.alerts.length > 0 && <div className="a4-alerts">MEDICAL ALERTS: {p.alerts.join(" · ")}</div>}
      {S.diagnosis && dx && <div className="a4-sec"><span className="a4-label">DIAGNOSIS</span><span>{dx}</span></div>}
      {items.length > 0 && (
        <table className="a4-rx">
          <thead><tr><th><span className="rx-sym">℞</span>Medicine</th><th>Dose</th><th>Days</th><th className="right">Qty</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id ?? i.drug}>
                <td><b>{i.drug}</b>{i.generic && <div className="sub">{i.generic}</div>}<div className="sub">{i.instruction}</div></td>
                <td className="nums"><b>{i.dose}</b></td>
                <td className="nowrap">{i.days ? `${i.days} days` : "—"}</td>
                <td className="right nums">{i.quantity ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {S.advice && advice.length > 0 && <div className="a4-sec"><span className="a4-label">ADVICE</span><span>{advice.join(". ")}.</span></div>}
    </Sheet>
  );
}

export type ReceiptData = { receipt: Receipt; patient: Patient; invoice: Invoice | null; inWords: string };

export function ReceiptSheet({ data, clinic, layout }: { data: ReceiptData; clinic: Clinic | null; layout: PrintLayout }) {
  const { receipt: r, patient: p, invoice: inv } = data;
  const t = utcToIst(r.receivedAt);
  const earlier = inv ? inv.receipts.filter((x) => x.receivedAt < r.receivedAt).reduce((a, x) => a + x.amountPaise, 0) : 0;
  const balanceAfter = inv ? inv.totalPaise - earlier - r.amountPaise : 0;
  return (
    <Sheet clinic={clinic} layout={layout} footLeft="Thank you. Keep this receipt for insurance claims."
      signLeft={layout.show.upi && clinic?.upiId ? <div className="a4-next"><span className="a4-label teal">PAY A BALANCE BY UPI</span><b>{clinic.upiId}</b></div> : <span />}>
      <div className="a4-title">
        <div><span className="a4-big">RECEIPT</span><div>No. <b>{r.number}</b>{inv ? ` · for bill ${inv.number}` : ""}</div></div>
        <div className="right">{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}<br />{label12(t.time)}</div>
      </div>
      <div className="a4-box">
        <span>Received from</span><b>{p.name}</b>
        <span>Patient ID</span><span>{p.code}{p.fileNo ? ` · File ${p.fileNo}` : ""}</span>
        {layout.show.phone && <><span>Mobile</span><span>{formatPhone(p.phoneCc, p.phone)}</span></>}
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
        <span><b>In words:</b> {data.inWords}</span>
        <span><b>Paid by:</b> {MODE_LABEL[r.mode]}{r.reference ? ` · ref. ${r.reference}` : ""}</span>
      </div>
    </Sheet>
  );
}
