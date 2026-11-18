import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { dayLabel } from "../components/Appointments";
import { addDays, label12, todayIst, utcToIst } from "../../shared/time";
import { DEFAULT_TEMPLATES, fill, KIND_LABEL, PLACEHOLDERS, waLink, type MessageKind, type Templates } from "../../shared/messages";

type QueuePatient = { id: string; name: string; code: string; phone: string; consent: boolean };
type QueueItem = { kind: MessageKind; refId: string; patient: QueuePatient; vars: Record<string, string>; detail: string; sentAt: string | null };
type Sent = { id: string; kind: MessageKind | "other"; body: string; createdAt: string; patient: { id: string; name: string; code: string } };

const ORDER: MessageKind[] = ["reminder", "lab_ready", "balance", "recall"];
const SECTION: Record<MessageKind, string> = {
  reminder: "Appointment reminders",
  lab_ready: "Lab work ready to fit",
  balance: "Balance due",
  recall: "Due for a check-up",
};
const EMPTY: Record<MessageKind, string> = {
  reminder: "No one is booked that day.",
  lab_ready: "Nothing back from the lab waiting to be fitted.",
  balance: "No unpaid bills.",
  recall: "No one is due for a 6-month check-up.",
};
const TABS = [["queue", "To send"], ["sent", "Sent"], ["wording", "Wording"]] as const;
type Tab = (typeof TABS)[number][0];

const when = (iso: string) => {
  const { day, time } = utcToIst(iso);
  return `${day === todayIst() ? "today" : dayLabel(day)}, ${label12(time)}`;
};

function useClinicVars() {
  const { clinic } = useClinic();
  return useMemo(() => ({
    clinic: clinic?.name ?? "", doctor: clinic?.doctorName ?? "", phone: clinic?.phone ?? "", upi: clinic?.upiId ?? "",
  }), [clinic]);
}

function QueueRow({ item, template, onSent }: { item: QueueItem; template: string; onSent: (at: string) => void }) {
  const base = useClinicVars();
  const auto = fill(template, { ...base, ...item.vars, name: item.patient.name });
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const body = text ?? auto;
  const link = waLink(item.patient.phone, body);

  async function record() {
    try {
      const r = await api<{ createdAt: string }>("/messages", { method: "POST", body: JSON.stringify({ patientId: item.patient.id, kind: item.kind, refId: item.refId, body }) });
      onSent(r.createdAt);
    } catch { /* WhatsApp still opened; the log just missed it */ }
  }

  return (
    <li className={"msg-row" + (item.sentAt ? " sent" : "")}>
      <div className="msg-who">
        <Link to={`/patients/${item.patient.id}`}><b>{item.patient.name}</b></Link> <span className="muted">{item.patient.code}</span>
        <span className="q-sub">{item.detail}</span>
      </div>
      {editing ? (
        <label className="field msg-edit"><span className="sr-only">Message to {item.patient.name}</span>
          <textarea className="input" rows={4} value={body} onChange={(e) => setText(e.target.value)} />
        </label>
      ) : <p className="msg-text">{body}</p>}
      <div className="msg-actions">
        {!item.patient.consent ? <span className="muted">Said no to WhatsApp</span>
          : !link ? <Link className="muted" to={`/patients/${item.patient.id}`}>Check their mobile number</Link>
          : (
            <>
              {item.sentAt && <span className="pill s-done">Sent {when(item.sentAt)}</span>}
              <a className={"btn" + (item.sentAt ? "" : " wa")} href={link} target="_blank" rel="noopener noreferrer" onClick={record}>
                {item.sentAt ? "Send again" : "Send on WhatsApp"}
              </a>
              <button type="button" className="link-btn" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
            </>
          )}
      </div>
    </li>
  );
}

function Queue({ templates }: { templates: Templates }) {
  const today = todayIst();
  const [day, setDay] = useState(addDays(today, 1));
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [err, setErr] = useState("");
  const [hideSent, setHideSent] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ items: QueueItem[] }>(`/messages/queue?day=${day}`).then((r) => live && setItems(r.items)).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [day]);

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!items) return <div className="card empty">Loading…</div>;
  const markSent = (it: QueueItem, at: string) => setItems((xs) => xs!.map((x) => (x === it ? { ...x, sentAt: at } : x)));

  return (
    <>
      <div className="msg-toolbar">
        <div className="seg" role="group" aria-label="Reminders for">
          <button type="button" aria-pressed={day === today} onClick={() => setDay(today)}>Today</button>
          <button type="button" aria-pressed={day === addDays(today, 1)} onClick={() => setDay(addDays(today, 1))}>Tomorrow</button>
        </div>
        <label className="field inline">Reminders for<input type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} /> Hide ones already sent</label>
      </div>
      {ORDER.map((kind) => {
        const all = items.filter((i) => i.kind === kind);
        const shown = hideSent ? all.filter((i) => !i.sentAt) : all;
        const left = all.filter((i) => !i.sentAt).length;
        return (
          <section key={kind} className="card msg-section">
            <h2>{SECTION[kind]}{kind === "reminder" ? `, ${dayLabel(day, { weekday: "long", day: "numeric", month: "short" })}` : ""}
              {all.length > 0 && <span className="muted"> · {left ? `${left} to send` : "all sent"}</span>}</h2>
            {shown.length === 0 ? <p className="muted">{all.length ? "All sent." : EMPTY[kind]}</p> : (
              <ul className="list">
                {shown.map((it) => <QueueRow key={`${it.kind}:${it.refId}`} item={it} template={templates[kind]} onSent={(at) => markSent(it, at)} />)}
              </ul>
            )}
          </section>
        );
      })}
      <p className="muted">Each button opens WhatsApp with the message typed in. Check it and tap Send there. Dentalog notes it as sent when you open it.</p>
    </>
  );
}

function SentLog() {
  const [rows, setRows] = useState<Sent[] | null>(null);
  useEffect(() => { api<Sent[]>("/messages").then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="card empty">Loading…</div>;
  if (!rows.length) return <div className="card empty">Nothing sent yet.</div>;
  return (
    <div className="card">
      <ul className="list">
        {rows.map((m) => (
          <li key={m.id} className="msg-row">
            <div className="msg-who">
              <Link to={`/patients/${m.patient.id}`}><b>{m.patient.name}</b></Link> <span className="muted">{m.patient.code}</span>
              <span className="q-sub">{m.kind === "other" ? "Message" : KIND_LABEL[m.kind]} · {when(m.createdAt)}</span>
            </div>
            <p className="msg-text">{m.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SAMPLE: Record<string, string> = {
  name: "Anitha Prakash", day: "Thursday 19 November", time: "5:30 PM", visit: "scaling", last: "March 2026",
  amount: "₹2,500", work: "zirconia crown",
};

function Wording() {
  const { settings, reload } = useClinic();
  const base = useClinicVars();
  const toast = useToast();
  const [draft, setDraft] = useState<Templates>(settings.templates);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const boxes = useRef<Partial<Record<MessageKind, HTMLTextAreaElement | null>>>({});
  const dirty = ORDER.some((k) => draft[k] !== settings.templates[k]);

  function insert(kind: MessageKind, word: string) {
    const el = boxes.current[kind];
    const cur = draft[kind];
    // Into the cursor spot if they were typing there, otherwise on the end.
    const typing = el && document.activeElement === el;
    const at = typing ? el.selectionStart : cur.length;
    const end = typing ? el.selectionEnd : cur.length;
    const glue = !typing && cur && !cur.endsWith(" ") ? " " : "";
    const next = `${cur.slice(0, at)}${glue}{${word}}${cur.slice(end)}`;
    setDraft({ ...draft, [kind]: next });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + glue.length + word.length + 2, at + glue.length + word.length + 2); });
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      await api("/clinic", { method: "PUT", body: JSON.stringify({ settings: { ...settings, templates: draft } }) });
      await reload();
      toast({ title: "Message wording saved" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      {ORDER.map((kind) => (
        <section key={kind} className="card msg-section">
          <div className="msg-tpl-head">
            <h2>{KIND_LABEL[kind]}</h2>
            {draft[kind] !== DEFAULT_TEMPLATES[kind] && <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, [kind]: DEFAULT_TEMPLATES[kind] })}>Use the original wording</button>}
          </div>
          <label className="field"><span className="sr-only">{KIND_LABEL[kind]} wording</span>
            <textarea ref={(el) => { boxes.current[kind] = el; }} className="input" rows={4} value={draft[kind]} onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })} />
          </label>
          <div className="chips" aria-label="Add a detail">
            {PLACEHOLDERS[kind].map((w) => <button key={w} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(kind, w)}>+ {w}</button>)}
          </div>
          <p className="msg-preview"><span className="muted">Looks like: </span>{fill(draft[kind], { ...base, ...SAMPLE })}</p>
        </section>
      ))}
      {err && <p className="error" role="alert">{err}</p>}
      {dirty && (
        <div className="save-bar">
          <span>Unsaved wording</span>
          <button type="button" className="btn" onClick={() => setDraft(settings.templates)}>Discard</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save wording"}</button>
        </div>
      )}
    </>
  );
}

export function Messages() {
  const { settings } = useClinic();
  const [tab, setTab] = useState<Tab>("queue");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="eyebrow">WhatsApp reminders, sent from your phone or computer</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Messages">
        {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      {tab === "queue" && <Queue templates={settings.templates} />}
      {tab === "sent" && <SentLog />}
      {tab === "wording" && <Wording />}
    </>
  );
}
