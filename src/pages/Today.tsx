import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Appointment } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { ApptDialog, BookDialog, dayLabel, NEXT_STEP, setStatus, STATUS_LABEL, timeRange } from "../components/Appointments";
import { addDays, label12, todayIst, weekday } from "../../shared/time";

export function Today() {
  const { hours } = useClinic();
  const toast = useToast();
  const day = todayIst();
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(false);
  const [open, setOpen] = useState<Appointment | null>(null);

  const load = useCallback(async () => {
    try { setAppts(await api<Appointment[]>(`/appointments?from=${day}&to=${addDays(day, 1)}`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [day]);
  useEffect(() => { load(); }, [load]);

  const h = hours[weekday(day)];
  const live = appts?.filter((a) => a.status !== "cancelled") ?? [];
  const count = (st: Appointment["status"]) => live.filter((a) => a.status === st).length;

  async function advance(a: Appointment) {
    const next = NEXT_STEP[a.status];
    if (!next) return;
    try {
      await setStatus(a, next[0]);
      load();
      toast({ title: `${a.patient.name}: ${STATUS_LABEL[next[0]]}`, onUndo: async () => { await setStatus(a, a.status); load(); } });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{dayLabel(day, { weekday: "long", day: "numeric", month: "short", year: "numeric" })} · {h ? `Open ${label12(h[0])} – ${label12(h[1])}` : "Closed today"}</p>
          <h1>Today</h1>
        </div>
        <button type="button" className="btn primary" onClick={() => setBooking(true)}>New appointment</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="stats">
        <div className="stat"><b>{live.length}</b><span>Booked</span></div>
        <div className="stat"><b>{count("arrived")}</b><span>Waiting</span></div>
        <div className="stat"><b>{count("in_chair")}</b><span>In chair</span></div>
        <div className="stat"><b>{count("done")}</b><span>Done</span></div>
      </div>

      <div className="card">
        <h2>Queue</h2>
        {appts && appts.length === 0 && (
          <p className="empty">No appointments today. <Link to="/calendar">Open the calendar</Link> to book one.</p>
        )}
        {!appts && !error && <p className="empty">Loading…</p>}
        <ul className="queue">
          {appts?.map((a) => {
            const next = NEXT_STEP[a.status];
            return (
              <li key={a.id} className={`q-row s-${a.status}`}>
                <span className="q-time nums">{timeRange(a)}</span>
                <button type="button" className="q-who" onClick={() => setOpen(a)}>
                  <b>{a.patient.name}</b> <span className="muted">{a.patient.code}</span>
                  <span className="q-sub">{a.visitType}{a.notes ? ` · ${a.notes}` : ""}{a.squeezedIn ? " · squeezed in" : ""}</span>
                  {a.patient.alerts.length > 0 && <span>{a.patient.alerts.map((x) => <span key={x} className="tag alert">{x}</span>)}</span>}
                </button>
                <span className={`pill s-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                {next ? <button type="button" className="btn small primary" onClick={() => advance(a)}>{next[1]}</button> : <span />}
              </li>
            );
          })}
        </ul>
      </div>

      {booking && <BookDialog day={day} onClose={() => setBooking(false)} onSaved={(msg) => { setBooking(false); toast({ title: msg }); load(); }} />}
      {open && <ApptDialog appt={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
