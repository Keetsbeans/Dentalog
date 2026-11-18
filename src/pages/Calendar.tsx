import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Appointment } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { ApptDialog, BookDialog, dayLabel, patientReply, REPLY_LABEL, STATUS_LABEL } from "../components/Appointments";
import { addDays, fromMinutes, label12, slots, todayIst, toMinutes, utcToIst, weekday, weekStart, type Hours } from "../../shared/time";

const ROW = 56; // px per 30 minutes
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

/** Side-by-side lanes so a squeezed-in booking never hides the one under it. */
function lanes(list: Appointment[]) {
  const span = (a: Appointment) => [new Date(a.startsAt).getTime(), new Date(a.startsAt).getTime() + a.minutes * 60_000] as const;
  const sorted = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const ends: number[] = [];
  const lane = new Map<string, number>();
  for (const a of sorted) {
    const [st, en] = span(a);
    let i = ends.findIndex((e) => e <= st);
    if (i < 0) i = ends.length;
    ends[i] = en; lane.set(a.id, i);
  }
  const width = new Map<string, number>();
  for (const a of sorted) {
    const [st, en] = span(a);
    const over = sorted.filter((b) => { const [bs, be] = span(b); return bs < en && st < be; });
    width.set(a.id, Math.max(...over.map((b) => lane.get(b.id)!)) + 1);
  }
  return (a: Appointment) => ({ lane: lane.get(a.id) ?? 0, of: width.get(a.id) ?? 1 });
}

/** The earliest opening and latest closing across the week, so every day lines up. */
function dayBounds(hours: Hours): [number, number] {
  const open = Object.values(hours).filter((h): h is [string, string] => !!h);
  if (!open.length) return [toMinutes("09:00"), toMinutes("18:00")];
  return [Math.min(...open.map((h) => toMinutes(h[0]))), Math.max(...open.map((h) => toMinutes(h[1])))];
}

export function Calendar() {
  const { hours } = useClinic();
  const toast = useToast();
  const [view, setView] = useState<"day" | "week">(narrow() ? "day" : "week");
  const [day, setDay] = useState(todayIst());
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");
  const [book, setBook] = useState<{ day: string; time?: string } | null>(null);
  const [open, setOpen] = useState<Appointment | null>(null);

  const days = useMemo(() => {
    if (view === "day") return [day];
    const mon = weekStart(day);
    const list = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
    // Hide a closed Sunday unless something is booked on it.
    return list.filter((d) => hours[weekday(d)] || appts?.some((a) => utcToIst(a.startsAt).day === d));
  }, [view, day, hours, appts]);

  const from = view === "day" ? day : weekStart(day);
  const to = addDays(from, view === "day" ? 1 : 7);
  const load = useCallback(async () => {
    try { setAppts(await api<Appointment[]>(`/appointments?from=${from}&to=${to}`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const [start, end] = dayBounds(hours);
  const rows: string[] = [];
  for (let t = start; t < end; t += 30) rows.push(fromMinutes(t));
  const today = todayIst();
  const step = view === "day" ? 1 : 7;
  const title = view === "day"
    ? dayLabel(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${dayLabel(from, { day: "numeric", month: "short" })} – ${dayLabel(addDays(from, 6), { day: "numeric", month: "short", year: "numeric" })}`;

  // Where the red "now" line sits, in minutes from midnight India time, if it falls on screen.
  const nowMin = toMinutes(utcToIst(new Date().toISOString()).time);

  return (
    <>
      <div className="page-head cal-head">
        <div className="cal-nav">
          <button type="button" className="btn small" aria-label={view === "day" ? "Previous day" : "Previous week"} onClick={() => setDay(addDays(day, -step))}>‹</button>
          <button type="button" className="btn small" aria-label={view === "day" ? "Next day" : "Next week"} onClick={() => setDay(addDays(day, step))}>›</button>
          <button type="button" className="btn small" onClick={() => setDay(today)}>Today</button>
        </div>
        <h1>{title}</h1>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")}>Day</button>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
        </div>
        <button type="button" className="btn primary" onClick={() => setBook({ day: day < today ? today : day })}>New appointment</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="card cal-card">
        <div className="cal" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(${view === "day" ? 200 : 120}px, 1fr))` }}>
          <div className="cal-corner" />
          {days.map((d) => {
            const n = appts?.filter((a) => utcToIst(a.startsAt).day === d && a.status !== "cancelled").length ?? 0;
            return (
              <button type="button" key={d} className={"cal-dayhead" + (d === today ? " is-today" : "")} onClick={() => { setDay(d); setView("day"); }}>
                <span>{dayLabel(d, { weekday: "short" })}</span>
                <b>{dayLabel(d, { day: "numeric", month: "short" })}</b>
                <span className="muted">{hours[weekday(d)] ? `${n} booked` : "Closed"}</span>
              </button>
            );
          })}

          <div className="cal-times">
            {rows.map((t) => <div key={t} style={{ height: ROW }}>{t.endsWith(":00") || t === rows[0] ? label12(t) : ""}</div>)}
          </div>
          {days.map((d) => {
            const open_ = new Set(slots(hours, d));
            const mine = appts?.filter((a) => utcToIst(a.startsAt).day === d) ?? [];
            const place = lanes(mine);
            return (
              <div key={d} className="cal-col" style={{ height: rows.length * ROW }}>
                {rows.map((t, i) => open_.has(t) ? (
                  <button type="button" key={t} className="cal-slot" style={{ top: i * ROW, height: ROW }}
                    aria-label={`Book ${dayLabel(d)} at ${label12(t)}`} onClick={() => setBook({ day: d, time: t })} />
                ) : (
                  <div key={t} className="cal-closed" style={{ top: i * ROW, height: ROW }} />
                ))}
                {mine.map((a) => {
                  const m = toMinutes(utcToIst(a.startsAt).time);
                  const h = Math.max((a.minutes / 30) * ROW - 4, 26);
                  const { lane, of } = place(a);
                  return (
                    <button type="button" key={a.id} className={`cal-appt s-${a.status}${a.squeezedIn ? " squeezed" : ""}`}
                      style={{ top: ((m - start) / 30) * ROW + 2, height: h, left: `calc(${(lane / of) * 100}% + 4px)`, width: `calc(${100 / of}% - 8px)` }}
                      aria-label={`${a.patient.name}, ${a.visitType}, ${label12(utcToIst(a.startsAt).time)}, ${STATUS_LABEL[a.status]}${patientReply(a) ? `, ${REPLY_LABEL[patientReply(a)!]}` : ""}`}
                      onClick={() => setOpen(a)}>
                      <b>{a.patient.name}</b>
                      {h > 40 && <span>{label12(utcToIst(a.startsAt).time)} · {a.visitType}{a.patient.alerts.length ? " · ⚠" : ""}</span>}
                      {patientReply(a) && <i className={`cal-reply ${patientReply(a)}`} title={REPLY_LABEL[patientReply(a)!]}>{patientReply(a) === "confirmed" ? "✓" : "?"}</i>}
                    </button>
                  );
                })}
                {d === today && nowMin >= start && nowMin <= end && <div className="cal-now" style={{ top: ((nowMin - start) / 30) * ROW }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
      <p className="muted legend">
        <span className="pill s-booked">Booked</span> <span className="pill s-arrived">Arrived</span> <span className="pill s-in_chair">In chair</span>{" "}
        <span className="pill s-done">Done</span> <span className="pill s-no_show">No-show</span>{" "}
        <i className="cal-reply confirmed legend">✓</i> confirmed from their link <i className="cal-reply reschedule legend">?</i> wants another time · Tap an empty slot to book.
      </p>

      {book && <BookDialog day={book.day} time={book.time} onClose={() => setBook(null)} onSaved={(msg) => { setBook(null); toast({ title: msg }); load(); }} />}
      {open && <ApptDialog appt={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
