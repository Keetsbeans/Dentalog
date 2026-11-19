import { useState, type FormEvent } from "react";
import { api, type Patient } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { fill, KIND_LABEL, type MessageKind } from "../../shared/messages";

const QUICK: MessageKind[] = ["care", "review", "recall", "lab_ready", "balance"];

/** For logins that can't send WhatsApp: write the message and leave it for the owner to send. */
export function AskMessage({ patient, onClose, onSaved }: { patient: Patient; onClose: () => void; onSaved: (msg: string) => void }) {
  const { clinic, settings } = useClinic();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MessageKind | "other">("other");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const first = patient.name.split(/\s+/)[0];

  function use(k: MessageKind) {
    setKind(k);
    setText(fill(settings.templates[k], {
      clinic: clinic?.name, doctor: clinic?.doctorName, phone: clinic?.phone, upi: clinic?.upiId, review: settings.reviewLink,
      name: first, last: "your last visit", work: "lab work",
    }));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api("/messages/requests", { method: "POST", body: JSON.stringify({ patientId: patient.id, kind, body: text }) });
      onSaved(`Message for ${first} is waiting for approval.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open" onSubmit={save} aria-labelledby="am-title">
        <h2 id="am-title">Ask to message {first}</h2>
        <p className="muted">The clinic owner reads it, then sends it on WhatsApp.</p>
        <div className="chips" aria-label="Start from a template">
          {QUICK.map((k) => <button key={k} type="button" className={"chip" + (kind === k ? " on" : "")} onClick={() => use(k)}>{KIND_LABEL[k]}</button>)}
        </div>
        <label className="field">Message
          <textarea className="input area tall" autoFocus value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setKind("other"); }} placeholder={`What should ${first} be told?`} />
        </label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Ask the owner to send"}</button>
        </div>
      </form>
    </div>
  );
}
