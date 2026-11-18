import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Appointment } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { ApptDialog, BookDialog, dayLabel, NEXT_STEP, patientReply, setStatus, STATUS_LABEL, timeRange } from "../components/Appointments";
import { addDays, fromMinutes, label12, todayIst, toMinutes, utcToIst, weekday } from "../../shared/time";
import { rupees } from "../../shared/money";
import type { TodayData } from "../../worker/today";

export function Today() {
  const { hours } = useClinic();
  const toast = useToast();
  const day = todayIst();
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(false);
  const [open, setOpen] = useState<Appointment | null>(null);
  const [info, setInfo] = useState<TodayData | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([api<Appointment[]>(`/appointments?from=${day}&to=${addDays(day, 1)}`), api<TodayData>("/today")]);
      setAppts(a); setInfo(i); setError("");
    }
    catch (e) { setError((e as Error).message); }
  }, [day]);
  useEffect(() => { load(); }, [load]);

  const h = hours[weekday(day)];
  const live = appts?.filter((a) => a.status !== "cancelled") ?? [];
  const count = (st: Appointment["status"]) => live.filter((a) => a.status === st).length;
  const seen = count("done"), here = count("arrived") + count("in_chair"), toCome = count("booked");
  const pctOf = (n: number) => `${live.length ? (n / live.length) * 100 : 0}%`;
  const billable = info?.toBill.reduce((a, x) => a + (x.paise ?? 0), 0) ?? 0;
  // The first 15-minute gap from now (or opening) to closing that nothing is booked in.
  const nowT = utcToIst(new Date().toISOString()).time;
  let nextFree: string | null = null;
  if (h) {
    const busy = live.filter((a) => a.status !== "no_show").map((a) => { const s0 = toMinutes(utcToIst(a.startsAt).time); return [s0, s0 + a.minutes] as const; });
    for (let m = Math.max(toMinutes(h[0]), Math.ceil(toMinutes(nowT) / 15) * 15); m + 15 <= toMinutes(h[1]); m += 15) {
      if (!busy.some(([a, b]) => m < b && m + 15 > a)) { nextFree = label12(fromMinutes(m)); break; }
    }
  }
  const walkTime = fromMinutes(Math.ceil(toMinutes(nowT) / 15) * 15);

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
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => setWalkIn(true)}>Walk-in</button>
          <button type="button" className="btn primary" onClick={() => setBooking(true)}>New appointment</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="home-stats">
        <div className="stat">
          <span className="stat-label">Patients today</span>
          <b className="nums">{seen} of {live.length} seen</b>
          <div className="progress" aria-hidden="true"><span className="p-done" style={{ width: pctOf(seen) }} /><span className="p-here" style={{ width: pctOf(here) }} /></div>
          <small>{here} at the clinic now · {toCome} still to come</small>
        </div>
        <div className="stat">
          <span className="stat-label">Collected today</span>
          <b className="nums">{rupees(info?.collectedPaise ?? 0)}</b>
          <small>{info && info.collectedPaise > 0 ? `From ${info.collectedFrom} patient${info.collectedFrom === 1 ? "" : "s"} · ${info.modes.join(" and ")}` : "Nothing collected yet"}</small>
        </div>
        <Link className="stat link" to="/billing">
          <span className="stat-label">Waiting to be billed</span>
          <b className={"nums" + (info?.toBill.length ? " amber" : "")}>{info?.toBill.length ? (billable > 0 ? rupees(billable) : `${info.toBill.length} to bill`) : "Nothing"}</b>
          <small>{info?.toBill.length ? info.toBill.slice(0, 3).map((x) => x.name).join(", ") + (info.toBill.length > 3 ? ` +${info.toBill.length - 3}` : "") : "All seen patients are billed"}</small>
        </Link>
        <Link className="stat link" to="/reports">
          <span className="stat-label">Still to collect</span>
          <b className={"nums" + (info?.outstandingPaise ? " due" : "")}>{rupees(info?.outstandingPaise ?? 0)}</b>
          <small>{info?.owingPatients ? `Unpaid balances from ${info.owingPatients} patient${info.owingPatients === 1 ? "" : "s"}` : "No unpaid bills"}</small>
        </Link>
      </div>

      <div className="home-grid">
      <div className="card">
        <div className="card-head">
          <h2>Patient queue</h2>
          {h && <span className="muted">Next free slot: {nextFree ?? "none left today"}</span>}
        </div>
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
                <span className="q-pills">
                  <span className={`pill s-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                  {patientReply(a) && <span className={`pill ${patientReply(a) === "confirmed" ? "s-ok" : "s-warn"}`}>{patientReply(a) === "confirmed" ? "Confirmed" : "Wants another time"}</span>}
                </span>
                {next ? <button type="button" className="btn small primary" onClick={() => advance(a)}>{next[1]}</button> : <span />}
              </li>
            );
          })}
        </ul>
      </div>
      <aside className="home-side">
        <section className="card">
          <h2>Needs attention</h2>
          <p className="muted">These clear on their own once the task is done.</p>
          {!info ? <p className="muted">Loading…</p> : info.attention.length === 0 ? <p className="ok-text">All clear. Nothing needs you right now.</p> : (
            <ul className="attention">
              {info.attention.map((x) => (
                <li key={x.key}><Link to={x.href}><i className={`dot ${x.tone}`} aria-hidden="true" /><span><b>{x.title}</b><span className="muted">{x.detail}</span></span></Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Rest of this week</h2><Link to="/calendar">Calendar</Link></div>
          <ul className="week-load">
            {info?.week.map((w) => (
              <li key={w.day}>
                <span>{w.day === day ? "Today" : dayLabel(w.day, { weekday: "short", day: "numeric" })}</span>
                {w.openMin ? <>
                  <div className="progress" title={`${Math.round((w.bookedMin / w.openMin) * 100)}% booked`}><span className="p-done" style={{ width: `${Math.min(100, (w.bookedMin / w.openMin) * 100)}%` }} /></div>
                  <span className="muted nums">{w.visits} visit{w.visits === 1 ? "" : "s"}</span>
                </> : <span className="muted closed">Closed</span>}
              </li>
            ))}
          </ul>
          <p className="muted">Bar = share of the day already booked</p>
        </section>
      </aside>
      </div>

      {walkIn && <BookDialog day={day} time={walkTime} visitType="Emergency" note="Walk-in" onClose={() => setWalkIn(false)} onSaved={(msg) => { setWalkIn(false); toast({ title: msg }); load(); }} />}
      {booking && <BookDialog day={day} onClose={() => setBooking(false)} onSaved={(msg) => { setBooking(false); toast({ title: msg }); load(); }} />}
      {open && <ApptDialog appt={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
