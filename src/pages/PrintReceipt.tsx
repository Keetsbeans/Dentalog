import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { PageSize, ReceiptSheet, type ReceiptData } from "../components/PrintSheet";

/** Payment receipt on the clinic letterhead. */
export function PrintReceipt() {
  const { id } = useParams();
  const { clinic, settings } = useClinic();
  const [d, setD] = useState<ReceiptData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<ReceiptData>(`/receipts/${id}`).then(setD).catch((e) => setError((e as Error).message)); }, [id]);
  useEffect(() => { document.title = d ? `Receipt ${d.receipt.number} · ${d.patient.name}` : "Receipt"; }, [d]);

  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>;
  if (!d || !clinic) return <p className="empty">Loading…</p>;
  return (
    <div className="print-wrap">
      <PageSize layout={settings.print} />
      <div className="print-bar no-print"><button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button></div>
      <ReceiptSheet data={d} clinic={clinic} layout={settings.print} />
    </div>
  );
}
