import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, type Invoice, type Patient, type PayMode } from "../lib/api";
import { useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { billTotal, PAY_MODES } from "../../shared/services";
import { useClinic } from "../lib/clinic";
import { rupees } from "../../shared/money";
import { dayLabel } from "./Appointments";
import { label12, utcToIst } from "../../shared/time";

/** "1,200" or "1200.50" → paise. Empty or bad → null. */
export function toPaise(s: string): number | null {
  const t = s.replace(/[,₹\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
const asRupees = (p: number) => (p / 100).toString();
export const MODE_LABEL = Object.fromEntries(PAY_MODES) as Record<PayMode, string>;

export function printReceipt(id: string) { window.open(`/print/receipt/${id}`, "_blank"); }

function PayFields({ amount, setAmount, mode, setMode, reference, setReference }: {
  amount: string; setAmount: (v: string) => void; mode: PayMode; setMode: (m: PayMode) => void; reference: string; setReference: (v: string) => void;
}) {
  return (
    <>
      <div className="row2">
        <label className="field">Amount received (₹)<input className="input nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field">{mode === "upi" ? "UPI ref. (optional)" : mode === "card" ? "Last 4 digits (optional)" : "Reference (optional)"}
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      <div className="chips" role="group" aria-label="Paid by">
        {PAY_MODES.map(([m, l]) => <button key={m} type="button" aria-pressed={mode === m} className={"chip teal" + (mode === m ? " on" : "")} onClick={() => setMode(m)}>{l}</button>)}
      </div>
    </>
  );
}

/** New bill: patient, services (with tooth), discount, and the payment taken now. */
export function NewBill({ patient: fixed, onClose, onSaved }: { patient?: Pick<Patient, "id" | "name" | "code">; onClose: () => void; onSaved: (msg: string, receiptId?: string) => void }) {
  const { settings } = useClinic();
  const [patient, setPatient] = useState(fixed ?? null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Patient[]>([]);
  const [lines, setLines] = useState<{ service: string; tooth: string; amount: string }[]>([]);
  const [discount, setDiscount] = useState("");
  const [payNow, setPayNow] = useState(true);
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [mode, setMode] = useState<PayMode>("upi");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (patient || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`).then((r) => setFound(r.slice(0, 6))).catch(() => setFound([])), 200);
    return () => clearTimeout(t);
  }, [q, patient]);

  const parsed = lines.map((l) => ({ service: l.service, tooth: l.tooth, amountPaise: toPaise(l.amount) ?? 0 }));
  const discountPaise = toPaise(discount) ?? 0;
  const total = billTotal(parsed, discountPaise);
  // The amount follows the total until it is typed over (part payment).
  useEffect(() => { if (!amountTouched) setAmount(asRupees(total)); }, [total, amountTouched]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!patient) { setErr("Choose a patient."); return; }
    setErr(""); setBusy(true);
    try {
      const payment = payNow ? { amountPaise: toPaise(amount) ?? 0, mode, reference } : null;
      const r = await api<{ number: string; receipt: { id: string; number: string } | null }>("/invoices", {
        method: "POST", body: JSON.stringify({ patientId: patient.id, lines: parsed, discountPaise, payment }),
      });
      onSaved(r.receipt ? `Bill ${r.number} saved. Receipt ${r.receipt.number} for ${rupees(payment!.amountPaise)}.` : `Bill ${r.number} saved, ${rupees(total)} due.`, r.receipt?.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open wide" onSubmit={save} aria-labelledby="bill-title">
        <h2 id="bill-title">New bill</h2>
        {patient ? (
          <div className="picked"><div><b>{patient.name}</b> <span className="muted">{patient.code}</span></div>
            {!fixed && <button type="button" className="btn small" onClick={() => { setPatient(null); setQ(""); }}>Change</button>}</div>
        ) : (
          <div className="field">
            <label htmlFor="bill-q">Patient</label>
            <input id="bill-q" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, patient ID or mobile" autoComplete="off" />
            {found.length > 0 && <ul className="picklist">{found.map((p) => <li key={p.id}><button type="button" onClick={() => setPatient(p)}><b>{p.name}</b> <span className="muted">{p.code} · {p.phone}</span></button></li>)}</ul>}
          </div>
        )}

        <fieldset className="field"><legend>Add services</legend>
          <div className="chips">
            {settings.services.map((s) => <button key={s.name} type="button" className="chip" onClick={() => setLines([...lines, { service: s.name, tooth: "", amount: s.paise ? asRupees(s.paise) : "" }])}>+ {s.name}{s.paise ? ` ${rupees(s.paise)}` : ""}</button>)}
          </div>
        </fieldset>
        {lines.length > 0 && (
          <div className="bill-lines">
            {lines.map((l, i) => (
              <div key={i} className="bill-line">
                <label className="field grow"><span className="sr-only">Service</span><input className="input" value={l.service} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, service: e.target.value } : x))} /></label>
                <label className="field tooth"><span className="sr-only">Tooth</span><input className="input" value={l.tooth} placeholder="Tooth" onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, tooth: e.target.value } : x))} /></label>
                <label className="field amt"><span className="sr-only">Amount in rupees</span><input className="input nums right" inputMode="decimal" value={l.amount} placeholder="₹" onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, amount: e.target.value } : x))} /></label>
                <button type="button" className="icon-btn" aria-label={`Remove ${l.service}`} onClick={() => setLines(lines.filter((_, n) => n !== i))}>×</button>
              </div>
            ))}
            <div className="bill-line"><span className="grow muted">Discount (₹)</span><label className="field amt"><span className="sr-only">Discount in rupees</span><input className="input nums right" inputMode="decimal" value={discount} placeholder="0" onChange={(e) => setDiscount(e.target.value)} /></label><span className="icon-pad" /></div>
            <div className="bill-total"><span>Total</span><b className="nums">{rupees(total)}</b></div>
          </div>
        )}

        <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Payment received now</label>
        {payNow && <PayFields amount={amount} setAmount={(v) => { setAmountTouched(true); setAmount(v); }} mode={mode} setMode={setMode} reference={reference} setReference={setReference} />}
        {payNow && (toPaise(amount) ?? 0) < total && (toPaise(amount) ?? 0) > 0 && <p className="note">Part payment. {rupees(total - (toPaise(amount) ?? 0))} will stay as balance due.</p>}

        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !lines.length}>{busy ? "Saving…" : payNow ? "Save and take payment" : "Save bill"}</button>
        </div>
      </form>
    </div>
  );
}

/** One bill: its lines, payments, take the balance, print a receipt, delete. */
export function BillDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayMode>("upi");
  const [reference, setReference] = useState("");
  const [confirm, setConfirm] = useState(false);

  const load = () => api<Invoice>(`/invoices/${id}`).then((r) => { setInv(r); setAmount(asRupees(r.balancePaise)); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay(e: FormEvent) {
    e.preventDefault(); setErr("");
    try {
      const r = await api<{ id: string; number: string }>(`/invoices/${id}/receipts`, { method: "POST", body: JSON.stringify({ amountPaise: toPaise(amount) ?? 0, mode, reference }) });
      setPaying(false); setReference(""); await load(); onChanged();
      toast({ title: `Receipt ${r.number} saved.` });
    } catch (e) { setErr((e as Error).message); }
  }

  async function remove() {
    setConfirm(false);
    try {
      await api(`/invoices/${id}`, { method: "DELETE" });
      onChanged(); onClose();
      toast({
        title: `“Bill ${inv!.number} · ${inv!.patient.name}” deleted`, sub: "Bill and its receipts · moving to Recently deleted",
        onUndo: async () => { await api(`/trash/invoice/${id}/restore`, { method: "POST" }); onChanged(); },
      });
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog open wide" role="dialog" aria-modal="true" aria-labelledby="inv-title">
        {!inv ? <p className="empty">{err || "Loading…"}</p> : (
          <>
            <div className="dialog-head">
              <div>
                <h2 id="inv-title">Bill {inv.number}</h2>
                <span className="muted"><Link to={`/patients/${inv.patient.id}`}>{inv.patient.name}</Link> · {inv.patient.code} · {dayLabel(utcToIst(inv.issuedAt).day, { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <button type="button" className="toast-close dark" aria-label="Close" onClick={onClose}>×</button>
            </div>
            <table className="mini">
              <tbody>
                {inv.lines.map((l) => <tr key={l.id}><td>{l.service}{l.tooth ? <span className="muted"> · tooth {l.tooth}</span> : ""}</td><td className="right nums">{rupees(l.amountPaise)}</td></tr>)}
                {inv.discountPaise > 0 && <tr><td className="muted">Discount</td><td className="right nums">– {rupees(inv.discountPaise)}</td></tr>}
                <tr className="strong"><td>Total</td><td className="right nums">{rupees(inv.totalPaise)}</td></tr>
                {inv.receipts.map((r) => (
                  <tr key={r.id}>
                    <td>Paid {MODE_LABEL[r.mode]} · {r.number} <span className="muted">{dayLabel(utcToIst(r.receivedAt).day)}, {label12(utcToIst(r.receivedAt).time)}</span>
                      {" "}<button type="button" className="link-btn inline" onClick={() => printReceipt(r.id)}>Print</button></td>
                    <td className="right nums">– {rupees(r.amountPaise)}</td>
                  </tr>
                ))}
                <tr className="strong"><td>Balance due</td><td className={"right nums" + (inv.balancePaise > 0 ? " due" : "")}>{inv.balancePaise > 0 ? rupees(inv.balancePaise) : "Nil"}</td></tr>
              </tbody>
            </table>
            {paying ? (
              <form className="stack" onSubmit={pay}>
                <PayFields amount={amount} setAmount={setAmount} mode={mode} setMode={setMode} reference={reference} setReference={setReference} />
                <div className="dialog-actions"><button type="button" className="btn" onClick={() => setPaying(false)}>Cancel</button><button type="submit" className="btn primary">Save payment</button></div>
              </form>
            ) : inv.balancePaise > 0 && <button type="button" className="btn primary" onClick={() => setPaying(true)}>Take payment</button>}
            {err && <p className="error" role="alert">{err}</p>}
            <div className="dialog-actions spread">
              {inv.receipts.length > 0 && <button type="button" className="btn" onClick={() => printReceipt(inv.receipts[inv.receipts.length - 1]!.id)}>Print latest receipt</button>}
              <button type="button" className="btn danger-outline" onClick={() => setConfirm(true)}>Delete bill</button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog open={confirm} title={`Delete bill ${inv?.number ?? ""}?`} confirmLabel="Delete bill" onCancel={() => setConfirm(false)} onConfirm={remove}
        warning={inv && inv.receipts.length ? `${inv.receipts.length} payment receipt${inv.receipts.length > 1 ? "s" : ""} will be deleted with it.` : undefined}>
        {inv?.patient.name} · {inv ? rupees(inv.totalPaise) : ""}. The number {inv?.number} won’t be reused.
      </ConfirmDialog>
    </div>
  );
}
