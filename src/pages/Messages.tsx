import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type Patient } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { dayLabel } from "../components/Appointments";
import { addDays, label12, todayIst, utcToIst } from "../../shared/time";
import { DEFAULT_TEMPLATES, fill, KIND_LABEL, KINDS, PLACEHOLDERS, waLink, type MessageKind, type Templates } from "../../shared/messages";

type QueuePatient = { id: string; name: string; code: string; phone: string; phoneCc: string; consent: boolean };
type Reply = "confirmed" | "reschedule" | null;
type QueueItem = { kind: MessageKind; refId: string; patient: QueuePatient; vars: Record<string, string>; detail: string; sentAt: string | null; dueAt?: string; reply?: Reply };
type LogRow = { id: string; kind: MessageKind | "other" | "patient"; direction: "out" | "in"; body: string; createdAt: string; patient: QueuePatient };

/** Sections on the "To send" tab. Care and review messages are sent from a conversation. */
const ORDER = ["soon", "reminder", "lab_ready", "balance", "recall"] as const;
type QueueKind = (typeof ORDER)[number];
const SECTION: Record<QueueKind, string> = {
  soon: "Same-day reminders",
  reminder: "Day-before reminders",
  lab_ready: "Lab work ready to fit",
  balance: "Balance due",
  recall: "Due for a check-up",
};
const EMPTY: Record<QueueKind, string> = {
  soon: "No one else is booked for later today.",
  reminder: "No one is booked that day.",
  lab_ready: "Nothing back from the lab waiting to be fitted.",
  balance: "No unpaid bills.",
  recall: "No one is due for a 6-month check-up.",
};
const TABS = [["queue", "To send"], ["chats", "Conversations"], ["wording", "Templates"]] as const;
type Tab = (typeof TABS)[number][0];

const when = (iso: string) => {
  const { day, time } = utcToIst(iso);
  return `${day === todayIst() ? "today" : dayLabel(day)}, ${label12(time)}`;
};
const clock = (iso: string) => label12(utcToIst(iso).time);

function useClinicVars() {
  const { clinic, settings } = useClinic();
  return useMemo(() => ({
    clinic: clinic?.name ?? "", doctor: clinic?.doctorName ?? "", phone: clinic?.phone ?? "", upi: clinic?.upiId ?? "", review: settings.reviewLink,
  }), [clinic, settings.reviewLink]);
}

function ReplyPill({ reply }: { reply?: Reply }) {
  if (reply === "confirmed") return <span className="pill s-done">Confirmed</span>;
  if (reply === "reschedule") return <span className="pill s-warn">Wants another time</span>;
  return null;
}

function QueueRow({ item, template, onSent }: { item: QueueItem; template: string; onSent: (at: string) => void }) {
  const base = useClinicVars();
  // A reworded reminder that dropped {link} still gets the confirm link.
  const tpl = item.vars.link && !template.includes("{link}") ? `${template}\n\nConfirm or ask for another time: {link}` : template;
  const auto = fill(tpl, { ...base, ...item.vars, name: item.patient.name.split(/\s+/)[0] });
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const body = text ?? auto;
  const link = waLink(item.patient.phoneCc, item.patient.phone, body);
  const due = item.dueAt ? (item.dueAt <= new Date().toISOString() ? "Due now" : `Due at ${clock(item.dueAt)}`) : null;

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
        {(due && !item.sentAt) || item.reply ? (
          <span className="msg-tags">
            {due && !item.sentAt && <span className={"pill " + (due === "Due now" ? "s-warn" : "s-booked")}>{due}</span>}
            <ReplyPill reply={item.reply} />
          </span>
        ) : null}
      </div>
      {editing ? (
        <label className="field msg-edit"><span className="sr-only">Message to {item.patient.name}</span>
          <textarea className="input" rows={5} value={body} onChange={(e) => setText(e.target.value)} />
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
  const { settings } = useClinic();
  const today = todayIst();
  const [day, setDay] = useState(addDays(today, 1));
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [err, setErr] = useState("");
  const [hideSent, setHideSent] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let live = true;
    api<{ items: QueueItem[] }>(`/messages/queue?day=${day}`).then((r) => live && setItems(r.items)).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [day]);
  // Same-day reminders turn "Due now" on their own.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!items) return <div className="card empty">Loading…</div>;
  const markSent = (it: QueueItem, at: string) => setItems((xs) => xs!.map((x) => (x === it ? { ...x, sentAt: at } : x)));

  const section = (kind: QueueKind) => {
    const all = items.filter((i) => i.kind === kind);
    const shown = hideSent ? all.filter((i) => !i.sentAt) : all;
    const left = all.filter((i) => !i.sentAt).length;
    const title = kind === "reminder" ? `${SECTION[kind]} for ${dayLabel(day, { weekday: "long", day: "numeric", month: "short" })}`
      : kind === "soon" ? `${SECTION[kind]}, ${settings.soonMinutes < 60 ? `${settings.soonMinutes} minutes` : `${settings.soonMinutes / 60} hour${settings.soonMinutes > 60 ? "s" : ""}`} before`
      : SECTION[kind];
    return (
      <section key={kind} className="card msg-section">
        <h2>{title}{all.length > 0 && <span className="muted"> · {left ? `${left} to send` : "all sent"}</span>}</h2>
        {kind === "reminder" && (
          <div className="msg-toolbar">
            <div className="seg small" role="group" aria-label="Reminders for">
              <button type="button" aria-pressed={day === today} onClick={() => setDay(today)}>Today</button>
              <button type="button" aria-pressed={day === addDays(today, 1)} onClick={() => setDay(addDays(today, 1))}>Tomorrow</button>
            </div>
            <label className="field inline">Or pick a day<input type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
          </div>
        )}
        {shown.length === 0 ? <p className="muted">{all.length ? "All sent." : EMPTY[kind]}</p> : (
          <ul className="list">
            {shown.map((it) => <QueueRow key={`${it.kind}:${it.refId}`} item={it} template={templates[kind]} onSent={(at) => markSent(it, at)} />)}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="msg-toolbar">
        <label className="check"><input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} /> Hide ones already sent</label>
      </div>
      {ORDER.map(section)}
      <p className="muted">Each button opens WhatsApp with the message typed in. Check it and tap Send there. Reminders carry a link where the patient can confirm or ask for another time, and their answer shows here and on the appointment.</p>
    </>
  );
}

/** Patient-facing tag on each message bubble. */
function tag(m: LogRow) {
  if (m.direction === "in") return "From their appointment link";
  if (m.kind === "other") return "Message";
  if (m.kind === "patient") return "";
  return `Automated · ${KIND_LABEL[m.kind].toLowerCase()}`;
}

function Conversations() {
  const [params, setParams] = useSearchParams();
  const sel = params.get("p");
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Patient[]>([]);
  const [extra, setExtra] = useState<QueuePatient | null>(null);

  const load = () => api<LogRow[]>("/messages").then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => api<Patient[]>(`/patients?q=${encodeURIComponent(q.trim())}`).then((r) => live && setFound(r.slice(0, 6))).catch(() => {}), 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const chats = useMemo(() => {
    const m = new Map<string, { p: QueuePatient; last: LogRow; fromThem: boolean }>();
    for (const r of rows ?? []) if (!m.has(r.patient.id)) m.set(r.patient.id, { p: r.patient, last: r, fromThem: r.direction === "in" });
    return [...m.values()];
  }, [rows]);
  const shownChats = q.trim() ? chats.filter((c) => `${c.p.name} ${c.p.code}`.toLowerCase().includes(q.trim().toLowerCase())) : chats;
  const current = chats.find((c) => c.p.id === sel)?.p ?? (extra?.id === sel ? extra : null);

  function open(p: QueuePatient) { setExtra(p); setParams({ tab: "chats", p: p.id }); setQ(""); }

  if (!rows) return <div className="card empty">Loading…</div>;
  return (
    <div className={"card chat" + (sel ? " has-sel" : "")}>
      <aside className="chat-list">
        <label className="field"><span className="sr-only">Find a patient</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a patient to message" />
        </label>
        {found.filter((f) => !shownChats.some((c) => c.p.id === f.id)).length > 0 && (
          <ul className="list chat-found">
            {found.filter((f) => !shownChats.some((c) => c.p.id === f.id)).map((f) => (
              <li key={f.id}><button type="button" className="chat-item" onClick={() => open({ id: f.id, name: f.name, code: f.code, phone: f.phone, phoneCc: f.phoneCc, consent: f.whatsappConsent ?? true })}>
                <b>{f.name}</b> <span className="muted">{f.code} · new message</span>
              </button></li>
            ))}
          </ul>
        )}
        {shownChats.length === 0 && !found.length ? <p className="muted chat-none">{q ? "No one found." : "No messages yet. Find a patient above to send one."}</p> : (
          <ul className="list">
            {shownChats.map(({ p, last, fromThem }) => (
              <li key={p.id}>
                <button type="button" className={"chat-item" + (p.id === sel ? " on" : "")} aria-current={p.id === sel} onClick={() => setParams({ tab: "chats", p: p.id })}>
                  <span className="chat-top"><b>{p.name}</b><span className="muted">{when(last.createdAt)}</span></span>
                  <span className="chat-last">{fromThem && <span className="dot blue" aria-label="From the patient" />}{last.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {current ? <Thread key={current.id} patient={current} rows={(rows ?? []).filter((r) => r.patient.id === current.id).reverse()} onBack={() => setParams({ tab: "chats" })} onSent={load} />
        : <div className="chat-thread chat-empty muted">Pick a conversation, or find a patient to message.</div>}
    </div>
  );
}

const QUICK: MessageKind[] = ["care", "review", "recall", "lab_ready"];

function Thread({ patient, rows, onBack, onSent }: { patient: QueuePatient; rows: LogRow[]; onBack: () => void; onSent: () => void }) {
  const { settings } = useClinic();
  const base = useClinicVars();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MessageKind | "other">("other");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [rows.length]);
  const link = text.trim() ? waLink(patient.phoneCc, patient.phone, text.trim()) : null;

  function use(k: MessageKind) {
    setKind(k);
    setText(fill(settings.templates[k], { ...base, name: patient.name.split(/\s+/)[0], last: "your last visit", work: "lab work" }));
  }
  async function record() {
    try {
      await api("/messages", { method: "POST", body: JSON.stringify({ patientId: patient.id, kind, refId: kind === "other" ? null : patient.id, body: text.trim() }) });
      setText(""); setKind("other"); onSent();
    } catch { /* WhatsApp still opened */ }
  }

  return (
    <section className="chat-thread" aria-label={`Messages with ${patient.name}`}>
      <header className="chat-head">
        <button type="button" className="link-btn chat-back" onClick={onBack}>‹ All</button>
        <div><b>{patient.name}</b> <span className="muted">{patient.code} · +{patient.phoneCc} {patient.phone}</span></div>
        <Link className="btn" to={`/patients/${patient.id}`}>Open record</Link>
      </header>
      <div className="chat-msgs">
        {rows.length === 0 && <p className="muted">No messages with {patient.name.split(/\s+/)[0]} yet.</p>}
        {rows.map((m) => (
          <div key={m.id} className={"bubble " + (m.direction === "in" ? "them" : m.kind === "other" ? "you" : "auto")}>
            {tag(m) && <span className="bubble-tag">{tag(m)}</span>}
            <p>{m.body}</p>
            <span className="bubble-meta">{m.direction === "in" ? "" : "Opened in WhatsApp · "}{when(m.createdAt)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="chat-compose">
        <div className="chips" aria-label="Start from a template">
          {QUICK.map((k) => <button key={k} type="button" className="chip" onClick={() => use(k)}>{KIND_LABEL[k]}</button>)}
        </div>
        <label className="field"><span className="sr-only">Message</span>
          <textarea className="input" rows={3} value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setKind("other"); }} placeholder={`Message ${patient.name.split(/\s+/)[0]}`} />
        </label>
        <div className="msg-actions">
          {!patient.consent ? <span className="muted">Said no to WhatsApp</span>
            : !waLink(patient.phoneCc, patient.phone, "x") ? <Link className="muted" to={`/patients/${patient.id}`}>Check their mobile number</Link>
            : <a className={"btn wa" + (link ? "" : " disabled")} aria-disabled={!link} href={link ?? undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => (link ? record() : e.preventDefault())}>Send on WhatsApp</a>}
        </div>
        <p className="muted small">Replies the patient types in WhatsApp stay in WhatsApp. What they do from their appointment link shows here.</p>
      </div>
    </section>
  );
}

const SAMPLE: Record<string, string> = {
  name: "Anitha", day: "Thursday 19 November", time: "5:30 PM", visit: "scaling", last: "March 2026",
  amount: "₹2,500", work: "zirconia crown", link: "https://dentalog…/c/Xy7…",
};
const SOON = [30, 60, 90, 120];

function Wording() {
  const { settings, reload } = useClinic();
  const base = useClinicVars();
  const toast = useToast();
  const [draft, setDraft] = useState<Templates>(settings.templates);
  const [soon, setSoon] = useState(settings.soonMinutes);
  const [review, setReview] = useState(settings.reviewLink);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const boxes = useRef<Partial<Record<MessageKind, HTMLTextAreaElement | null>>>({});
  const dirty = KINDS.some((k) => draft[k] !== settings.templates[k]) || soon !== settings.soonMinutes || review !== settings.reviewLink;

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
    const r = review.trim();
    if (r && !/^https:\/\/\S+$/.test(r)) return setErr("The review link should start with https://");
    setBusy(true); setErr("");
    try {
      await api("/clinic", { method: "PUT", body: JSON.stringify({ settings: { ...settings, templates: draft, soonMinutes: soon, reviewLink: r } }) });
      await reload();
      toast({ title: "Templates saved" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <section className="card msg-section">
        <h2>When to remind</h2>
        <div className="row2">
          <label className="field">Same-day reminder goes out
            <select className="input" value={soon} onChange={(e) => setSoon(Number(e.target.value))}>
              {SOON.map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`} before the appointment</option>)}
            </select>
          </label>
          <label className="field">Google review link (for “Ask for a review”)
            <input className="input" type="url" value={review} onChange={(e) => setReview(e.target.value)} placeholder="https://g.page/r/…" />
          </label>
        </div>
        <p className="muted">Dentalog flags each same-day reminder on the To send tab, and on the home page, when it’s due. Day-before reminders show from the day before.</p>
      </section>
      {KINDS.map((kind) => (
        <section key={kind} className="card msg-section">
          <div className="msg-tpl-head">
            <h2>{KIND_LABEL[kind]}</h2>
            {draft[kind] !== DEFAULT_TEMPLATES[kind] && <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, [kind]: DEFAULT_TEMPLATES[kind] })}>Use the original wording</button>}
          </div>
          <label className="field"><span className="sr-only">{KIND_LABEL[kind]} wording</span>
            <textarea ref={(el) => { boxes.current[kind] = el; }} className="input" rows={5} value={draft[kind]} onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })} />
          </label>
          <div className="chips" aria-label="Add a detail">
            {PLACEHOLDERS[kind].map((w) => <button key={w} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(kind, w)}>+ {w}</button>)}
          </div>
          <p className="msg-preview"><span className="muted">Looks like: </span>{fill(draft[kind], { ...base, review: review || "https://g.page/r/…", ...SAMPLE })}</p>
        </section>
      ))}
      {err && <p className="error" role="alert">{err}</p>}
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <button type="button" className="btn" onClick={() => { setDraft(settings.templates); setSoon(settings.soonMinutes); setReview(settings.reviewLink); }}>Discard</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save templates"}</button>
        </div>
      )}
    </>
  );
}

export function Messages() {
  const { settings } = useClinic();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.find(([t]) => t === params.get("tab"))?.[0]) ?? "queue";
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="eyebrow">WhatsApp reminders and messages, written as the clinic’s automated service</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Messages">
        {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setParams({ tab: t })}>{l}</button>)}
      </div>
      {tab === "queue" && <Queue templates={settings.templates} />}
      {tab === "chats" && <Conversations />}
      {tab === "wording" && <Wording />}
    </>
  );
}
