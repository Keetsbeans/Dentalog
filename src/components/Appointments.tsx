import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, startVisit, type Appointment, type ApptStatus, type Patient } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { PhoneInput } from "./PatientForm";
import { formatPhone } from "../../shared/phone";
import { label12, slots, utcToIst } from "../../shared/time";
import { useMe } from "./AuthGate";

const LENGTHS: [number, string][] = [[15, "15 min"], [20, "20 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1½ hours"]];

export const STATUS_LABEL: Record<ApptStatus, string> = {
  booked: "Booked", arrived: "Arrived", in_chair: "In chair", done: "Done", no_show: "No-show", cancelled: "Cancelled",
};
/** The one button that moves an appointment along: Booked → Arrived → In chair → Done. */
export const NEXT_STEP: Partial<Record<ApptStatus, [ApptStatus, string]>> = {
  booked: ["arrived", "Mark arrived"], arrived: ["in_chair", "Into the chair"], in_chair: ["done", "Mark done"],
};

export function timeRange(a: Appointment) {
  const { time } = utcToIst(a.startsAt);
  const end = utcToIst(new Date(new Date(a.startsAt).getTime() + a.minutes * 60_000).toISOString()).time;
  return `${label12(time)} – ${label12(end)}`;
}

export function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** What the patient did from their appointment link, if anything. */
export function patientReply(a: Pick<Appointment, "confirmedAt" | "rescheduleAt" | "status">): "confirmed" | "reschedule" | null {
  if (a.status !== "booked") return null;
  if (a.rescheduleAt && (!a.confirmedAt || a.rescheduleAt > a.confirmedAt)) return "reschedule";
  return a.confirmedAt ? "confirmed" : null;
}
export const REPLY_LABEL = { confirmed: "Patient confirmed", reschedule: "Wants another time" } as const;

export async function setStatus(a: Appointment, status: ApptStatus) {
  await api(`/appointments/${a.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

/** New appointment: pick (or add) a patient, the day, time, length and visit type. */
export function BookDialog({ day: day0, time: time0, patient: patient0, visitType: visit0, note: note0, onClose, onSaved }: {
  day: string; time?: string; patient?: Patient; visitType?: string; note?: string; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { hours, settings } = useClinic();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(patient0 ?? null);
  const [newPhone, setNewPhone] = useState("");
  const [newCc, setNewCc] = useState("91");
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(day0);
  const daySlots = slots(hours, day, 30, settings.holidays);
  const [time, setTime] = useState(time0 ?? daySlots[0] ?? "15:30");
  const [minutes, setMinutes] = useState(settings.visitTypes.find((v) => v.name === visit0)?.minutes ?? 30);
  const [visitType, setVisitType] = useState(visit0 ?? "Consultation");
  const [notes, setNotes] = useState(note0 ?? "");
  const [err, setErr] = useState("");
  const [clash, setClash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (patient || adding || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`).then((r) => setFound(r.slice(0, 6))).catch(() => setFound([])), 200);
    return () => clearTimeout(t);
  }, [q, patient, adding]);

  async function save(e: FormEvent, squeezedIn = false) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      let p = patient;
      if (!p && adding) {
        const r = await api<{ id: string; code: string }>("/patients", { method: "POST", body: JSON.stringify({ name: q, phoneCc: newCc, phone: newPhone }) });
        p = { id: r.id, code: r.code, name: q.trim(), phoneCc: newCc, phone: newPhone, alerts: [] } as unknown as Patient;
        setPatient(p); setAdding(false);
      }
      if (!p) { setErr("Choose a patient, or add them as new."); return; }
      await api("/appointments", { method: "POST", body: JSON.stringify({ patientId: p.id, day, time, minutes, visitType, notes, squeezedIn }) });
      onSaved(`${p.name} booked for ${dayLabel(day)}, ${label12(time)}${squeezedIn ? " (squeezed in)" : ""}.`);
    } catch (e) {
      setErr((e as Error).message);
      setClash(e instanceof ApiError && e.clash);
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open" onSubmit={save} aria-labelledby="book-title">
        <h2 id="book-title">New appointment</h2>

        {patient ? (
          <div className="picked">
            <div><b>{patient.name}</b> <span className="muted">{patient.code}</span>
              {patient.alerts?.map((a) => <span key={a} className="tag alert">{a}</span>)}</div>
            <button type="button" className="btn small" onClick={() => { setPatient(null); setQ(""); }}>Change</button>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="book-q">Patient</label>
            <input id="book-q" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, patient ID or mobile" autoComplete="off" />
            {found.length > 0 && (
              <ul className="picklist">
                {found.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => setPatient(p)}>
                    <b>{p.name}</b> <span className="muted">{p.code} · {formatPhone(p.phoneCc, p.phone)}</span>
                  </button></li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && !adding && (
              <button type="button" className="link-btn" onClick={() => setAdding(true)}>+ Add “{q.trim()}” as a new patient</button>
            )}
            {adding && (
              <PhoneInput id="book-phone" label={`Mobile for ${q.trim() || "new patient"}`} cc={newCc} phone={newPhone} onChange={(c, p) => { setNewCc(c); setNewPhone(p); }} />
            )}
          </div>
        )}

        <div className="row2">
          <label className="field">Day<input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="field">Time
            <select className="input" value={time} onChange={(e) => setTime(e.target.value)}>
              {!daySlots.includes(time) && <option value={time}>{label12(time)}</option>}
              {daySlots.map((t) => <option key={t} value={t}>{label12(t)}</option>)}
            </select>
          </label>
          <label className="field">Length
            <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {LENGTHS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
            </select>
          </label>
        </div>
        {daySlots.length === 0 && <p className="warn">The clinic is closed that day. You can still book it.</p>}

        <fieldset className="field"><legend>Visit</legend>
          <div className="chips">
            {settings.visitTypes.map(({ name: v, minutes: m }) => (
              <button key={v} type="button" aria-pressed={visitType === v} className={"chip teal" + (visitType === v ? " on" : "")} onClick={() => { setVisitType(v); setMinutes(m); }}>{v}</button>
            ))}
          </div>
        </fieldset>
        <label className="field">Note (optional)<input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. RCT sitting 2 of 3" /></label>

        {err && (
          <div className="error-box" role="alert">
            <p className="error">{err}</p>
            {clash && <button type="button" className="btn small" onClick={(e) => save(e, true)}>Book anyway, it’s an emergency</button>}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Booking…" : "Book"}</button>
        </div>
      </form>
    </div>
  );
}

/** Tap an appointment: see it, move it along, mark no-show, cancel or delete. */
export function ApptDialog({ appt, onClose, onChanged }: { appt: Appointment; onClose: () => void; onChanged: () => void }) {
  const { can } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);

  /** Opening the note also moves a waiting patient into the chair. */
  async function openNote() {
    try {
      if (appt.status === "booked" || appt.status === "arrived") await setStatus(appt, "in_chair");
      nav(`/visits/${await startVisit(appt.patient.id, appt.id)}`);
    } catch (e) { setErr((e as Error).message); }
  }
  const next = NEXT_STEP[appt.status];
  const { day } = utcToIst(appt.startsAt);

  async function change(status: ApptStatus) {
    try {
      const before = appt.status;
      await setStatus(appt, status);
      onChanged(); onClose();
      toast({
        title: `${appt.patient.name}: ${STATUS_LABEL[status]}`,
        onUndo: async () => { await setStatus(appt, before); onChanged(); },
      });
    } catch (e) { setErr((e as Error).message); }
  }

  async function remove() {
    setConfirm(false);
    try {
      await api(`/appointments/${appt.id}`, { method: "DELETE" });
      onChanged(); onClose();
      toast({
        title: `“${appt.patient.name}, ${dayLabel(day)}” deleted`,
        sub: "Appointment · moving to Recently deleted",
        onUndo: async () => { await api(`/trash/appointment/${appt.id}/restore`, { method: "POST" }); onChanged(); },
      });
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog open" role="dialog" aria-modal="true" aria-labelledby="appt-title">
        <div className="dialog-head">
          <div>
            <h2 id="appt-title">{appt.patient.name}</h2>
            <span className="muted">{appt.patient.code} · {formatPhone(appt.patient.phoneCc, appt.patient.phone)}</span>
            <div>{appt.patient.alerts.map((a) => <span key={a} className="tag alert">{a}</span>)}</div>
          </div>
          <button type="button" className="toast-close dark" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <dl className="facts">
          <dt>Visit</dt><dd>{appt.visitType}{appt.squeezedIn ? " · squeezed in" : ""}</dd>
          <dt>When</dt><dd>{dayLabel(day, { weekday: "long", day: "numeric", month: "short" })}, {timeRange(appt)}</dd>
          <dt>Status</dt><dd><span className={`pill s-${appt.status}`}>{STATUS_LABEL[appt.status]}</span>{patientReply(appt) && <> <span className={`pill ${patientReply(appt) === "confirmed" ? "s-ok" : "s-warn"}`}>{REPLY_LABEL[patientReply(appt)!]}</span></>}</dd>
          {appt.notes && <><dt>Note</dt><dd>{appt.notes}</dd></>}
        </dl>
        {err && <p className="error" role="alert">{err}</p>}
        {next && <button type="button" className="btn primary" onClick={() => change(next[0])}>{next[1]}</button>}
        {appt.status !== "cancelled" && appt.status !== "no_show" && (
          <button type="button" className="btn" onClick={openNote}>{appt.status === "done" ? "Open visit note" : "Start visit note"}</button>
        )}
        <Link className="link-btn" to={`/patients/${appt.patient.id}`}>Open {appt.patient.name}’s record</Link>
        <div className="dialog-actions spread">
          {appt.status === "booked" && <button type="button" className="btn" onClick={() => change("no_show")}>No-show</button>}
          {(appt.status === "booked" || appt.status === "arrived") && <button type="button" className="btn" onClick={() => change("cancelled")}>Cancel visit</button>}
          {(appt.status === "no_show" || appt.status === "cancelled" || appt.status === "done") && <button type="button" className="btn" onClick={() => change("booked")}>Back to booked</button>}
          {can("delete") && <button type="button" className="btn danger-outline" onClick={() => setConfirm(true)}>Delete</button>}
        </div>
      </div>
      <ConfirmDialog open={confirm} title="Delete this appointment?" confirmLabel="Delete appointment" onCancel={() => setConfirm(false)} onConfirm={remove}>
        {appt.patient.name} · {appt.visitType} · {dayLabel(day)}, {timeRange(appt)}. To keep a record that they didn’t come, use No-show or Cancel instead.
      </ConfirmDialog>
    </div>
  );
}
