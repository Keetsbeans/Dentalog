import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { rupees } from "../../shared/money";
import type { PayMode } from "../../shared/services";
import { MODE_LABEL } from "../components/Billing";
import { addDays, todayIst } from "../../shared/time";
import type { Bucket, Report } from "../../shared/report";
import { dayLabel } from "../components/Appointments";

type RangeKey = "7d" | "month" | "last-month" | "6m";
const RANGES: [RangeKey, string][] = [["7d", "Last 7 days"], ["month", "This month"], ["last-month", "Last month"], ["6m", "Last 6 months"]];

function range(k: RangeKey, today = todayIst()): [string, string] {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (k === "7d") return [addDays(today, -6), today];
  if (k === "month") return [monthStart, today];
  if (k === "last-month") {
    const end = addDays(monthStart, -1);
    return [`${end.slice(0, 7)}-01`, end];
  }
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 5);
  return [d.toISOString().slice(0, 10), today];
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");

function bucketLabel(b: Bucket, by: Report["by"], long = false) {
  if (by === "month") return dayLabel(`${b.key}-01`, { month: long ? "long" : "short", ...(long ? { year: "numeric" } : {}) });
  return dayLabel(b.key, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric" });
}

/** Rounds the top of the scale to a friendly rupee figure. */
function niceMax(paise: number) {
  const r = Math.max(paise / 100, 1000);
  const step = 10 ** Math.floor(Math.log10(r));
  return Math.ceil(r / step) * step * 100;
}

function CollectionsChart({ r }: { r: Report }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...r.series.map((b) => b.collectedPaise)));
  const many = r.series.length > 16;
  const shown = hover !== null ? r.series[hover] : null;
  return (
    <div className="chart">
      <div className="chart-head">
        <h2>Money collected</h2>
        <span className="muted" aria-live="polite">
          {shown ? <>{bucketLabel(shown, r.by, true)}: <b className="nums">{rupees(shown.collectedPaise)}</b> · {shown.visits} visit{shown.visits === 1 ? "" : "s"}</>
            : `By ${r.by}. Hover or tap a bar for details.`}
        </span>
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => <div key={f}><span className="nums">{rupees(max * f).replace(".00", "")}</span></div>)}
        </div>
        <div className="chart-bars" onMouseLeave={() => setHover(null)}>
          {r.series.map((b, i) => (
            <button key={b.key} type="button" className={"bar-hit" + (hover === i ? " on" : "")}
              aria-label={`${bucketLabel(b, r.by, true)}: ${rupees(b.collectedPaise)}, ${b.visits} visits`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}>
              <span className="bar" style={{ height: `${(b.collectedPaise / max) * 100}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {r.series.map((b, i) => (
          <span key={b.key}>{!many || i % Math.ceil(r.series.length / 8) === 0 ? bucketLabel(b, r.by) : ""}</span>
        ))}
      </div>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>{r.by === "month" ? "Month" : "Day"}</th><th className="num">Collected</th><th className="num">Visits</th></tr></thead>
            <tbody>{r.series.map((b) => (
              <tr key={b.key}><td>{bucketLabel(b, r.by, true)}</td><td className="num nums">{rupees(b.collectedPaise)}</td><td className="num">{b.visits}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function Reports() {
  const [key, setKey] = useState<RangeKey>("month");
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [from, to] = range(key);

  useEffect(() => {
    let live = true;
    setErr("");
    api<Report>(`/reports?from=${from}&to=${to}`).then((x) => live && setR(x)).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [from, to]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="eyebrow">{dayLabel(from, { day: "numeric", month: "short", year: "numeric" })} – {dayLabel(to, { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <div className="seg report-range" role="group" aria-label="Period">
          {RANGES.map(([k, l]) => <button key={k} type="button" aria-pressed={key === k} onClick={() => setKey(k)}>{l}</button>)}
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!r ? <div className="card empty">Loading…</div> : (
        <>
          <div className="stats report-stats">
            <div className="stat"><b className="nums">{rupees(r.collectedPaise)}</b><span>Collected</span></div>
            <div className="stat"><b className="nums">{rupees(r.collectedPaise - r.labPaise)}</b><span>After lab bills ({rupees(r.labPaise)})</span></div>
            <div className="stat"><b>{r.visits}</b><span>Visits signed</span></div>
            <div className="stat"><b className="nums">{r.visits ? rupees(Math.round(r.collectedPaise / r.visits)) : "–"}</b><span>Average per visit</span></div>
            <div className="stat"><b>{r.newPatients}</b><span>New patients</span></div>
            <div className="stat"><b>{pct(r.noShows, r.came + r.noShows)}</b><span>No-shows ({r.noShows} of {r.came + r.noShows})</span></div>
          </div>

          <div className="card"><CollectionsChart r={r} /></div>

          <div className="report-grid">
            <section className="card">
              <h2>How they paid</h2>
              {r.modes.length === 0 ? <p className="muted">No payments in this period.</p> : (
                <ul className="breakdown">
                  {r.modes.map((m) => (
                    <li key={m.mode}>
                      <div className="breakdown-row"><span>{MODE_LABEL[m.mode as PayMode] ?? m.mode} <span className="muted">· {m.count}</span></span><b className="nums">{rupees(m.paise)}</b></div>
                      <div className="meter"><span style={{ width: pct(m.paise, r.collectedPaise) }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Treatments billed</h2>
              {r.services.length === 0 ? <p className="muted">No bills in this period.</p> : (
                <ul className="breakdown">
                  {r.services.map((sv) => (
                    <li key={sv.service}>
                      <div className="breakdown-row"><span>{sv.service} <span className="muted">· {sv.count}</span></span><b className="nums">{rupees(sv.paise)}</b></div>
                      <div className="meter"><span style={{ width: pct(sv.paise, r.services[0]?.paise ?? 0) }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">Billed in total: <b className="nums">{rupees(r.billedPaise)}</b></p>
            </section>

            <section className="card">
              <h2>Still to collect</h2>
              <p className="report-big nums">{rupees(r.outstandingPaise)}</p>
              <p className="muted">Unpaid balance on all bills, not only this period.</p>
              {r.owing.length > 0 && (
                <ul className="owing">
                  {r.owing.map((o) => (
                    <li key={o.id}><Link to={`/patients/${o.id}`}>{o.name}</Link> <span className="muted">{o.code}</span><b className="nums">{rupees(o.balancePaise)}</b></li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Appointments</h2>
              <dl className="facts">
                <dt>Booked</dt><dd>{r.booked}</dd>
                <dt>Came</dt><dd>{r.came}</dd>
                <dt>No-show</dt><dd>{r.noShows}</dd>
                <dt>Cancelled</dt><dd>{r.cancelled}</dd>
              </dl>
            </section>
          </div>
        </>
      )}
    </>
  );
}
