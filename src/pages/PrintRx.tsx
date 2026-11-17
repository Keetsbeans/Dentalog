import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, type VisitBundle } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { dayLabel } from "../components/Appointments";
import { label12, utcToIst } from "../../shared/time";

/** A4 prescription on the clinic letterhead. Opens in its own tab; Print or Save as PDF from there. */
export function PrintRx() {
  const { id } = useParams();
  const { clinic } = useClinic();
  const [r, setR] = useState<VisitBundle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<VisitBundle>(`/visits/${id}`).then(setR).catch((e) => setError((e as Error).message)); }, [id]);
  useEffect(() => { document.title = r ? `Prescription · ${r.patient.name}` : "Prescription"; }, [r]);

  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>;
  if (!r) return <p className="empty">Loading…</p>;
  const { visit: v, patient: p, items } = r;
  const t = utcToIst(v.signedAt ?? v.createdAt);
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const dx = [v.tooth ? `Tooth ${v.tooth}` : "", v.diagnosis.join(", ")].filter(Boolean).join(": ");
  const advice = [...v.advice, v.adviceNote ?? ""].filter(Boolean);
  const doctor = clinic?.doctorName ?? "Dr Soosi Christopher";

  return (
    <div className="print-wrap">
      <div className="print-bar no-print">
        {!v.signedAt && <span className="warn">Draft: sign the note before giving this to the patient.</span>}
        <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="a4">
        <header className="a4-head">
          <img src="/letterhead.jpg" alt={`${clinic?.name ?? "Oyster Dental Care"} letterhead`} />
          <div className="a4-doc"><b>{doctor}</b>{clinic?.qualification ? `, ${clinic.qualification}` : ""}</div>
        </header>
        <div className="a4-body">
          <div className="a4-patient">
            <span><b className="big">{p.name}</b>{p.gender ? ` · ${p.gender}` : ""}{age ? `, ${age}` : ""}</span>
            <span className="right">{dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}, {label12(t.time)}</span>
            <span>{p.code}{p.fileNo ? ` · File ${p.fileNo}` : ""} · +91 {p.phone.slice(0, 5)} {p.phone.slice(5)}</span>
          </div>
          {p.alerts.length > 0 && <div className="a4-alerts">MEDICAL ALERTS: {p.alerts.join(" · ")}</div>}
          {dx && <div className="a4-sec"><span className="a4-label">DIAGNOSIS</span><span>{dx}</span></div>}
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
          {advice.length > 0 && <div className="a4-sec"><span className="a4-label">ADVICE</span><span>{advice.join(". ")}.</span></div>}
          <div className="a4-foot-row">
            {v.nextVisit ? <div className="a4-next"><span className="a4-label teal">NEXT VISIT</span><b>{v.nextVisit}</b></div> : <span />}
            <div className="a4-sign"><div className="line" /><b>{doctor}</b><span>Signature &amp; stamp</span></div>
          </div>
        </div>
        <footer className="a4-foot"><span>Not valid without signature</span><span>Made with Dentalog</span></footer>
      </article>
    </div>
  );
}
