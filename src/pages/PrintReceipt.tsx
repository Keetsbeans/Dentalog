import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { PageSize, ReceiptSheet, type ReceiptData } from "../components/PrintSheet";
import { SAMPLE_RECEIPT } from "../components/PrintSamples";

/** Payment receipt on the clinic letterhead. */
export function PrintReceipt() {
  const { id } = useParams();
  const { clinic, settings } = useClinic();
  const test = id === "test";
  const [d, setD] = useState<ReceiptData | null>(test ? SAMPLE_RECEIPT : null);
  const [error, setError] = useState("");
  useEffect(() => { if (!test) api<ReceiptData>(`/receipts/${id}`).then(setD).catch((e) => setError((e as Error).message)); }, [id, test]);
  useEffect(() => { document.title = test ? "Test page" : d ? `Receipt ${d.receipt.number} · ${d.patient.name}` : "Receipt"; }, [d, test]);

  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>;
  if (!d || !clinic) return <p className="empty">Loading…</p>;
  return (
    <div className="print-wrap">
      <PageSize layout={settings.printReceipt} />
      <div className="print-bar no-print">{test && <span className="warn">Test page with a sample patient. Print it on your paper to check the spacing.</span>}<button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button></div>
      <ReceiptSheet data={d} clinic={clinic} layout={settings.printReceipt} />
    </div>
  );
}
