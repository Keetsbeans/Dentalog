import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, type VisitBundle } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { PageSize, RxSheet } from "../components/PrintSheet";
import { SAMPLE_RX } from "../components/PrintSamples";

/** Prescription on the clinic letterhead. Opens in its own tab; Print or Save as PDF from there. `/print/rx/test` prints a sample. */
export function PrintRx() {
  const { id } = useParams();
  const { clinic, settings } = useClinic();
  const test = id === "test";
  const [r, setR] = useState<VisitBundle | null>(test ? SAMPLE_RX : null);
  const [error, setError] = useState("");
  useEffect(() => { if (!test) api<VisitBundle>(`/visits/${id}`).then(setR).catch((e) => setError((e as Error).message)); }, [id, test]);
  useEffect(() => { document.title = test ? "Test page" : r ? `Prescription · ${r.patient.name}` : "Prescription"; }, [r, test]);

  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>;
  if (!r || !clinic) return <p className="empty">Loading…</p>;
  return (
    <div className="print-wrap">
      <PageSize layout={settings.print} />
      <div className="print-bar no-print">
        {test && <span className="warn">Test page with a sample patient. Print it on your pad to check the spacing.</span>}
        {!test && !r.visit.signedAt && <span className="warn">Draft: sign the note before giving this to the patient.</span>}
        <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <RxSheet data={r} clinic={clinic} layout={settings.print} />
    </div>
  );
}
