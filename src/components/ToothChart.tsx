import { useEffect, useState } from "react";
import { api, type Patient } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "./Toast";
import { BookDialog, dayLabel } from "./Appointments";
import { NewBill, printReceipt } from "./Billing";
import { rupees } from "../../shared/money";
import { label12, todayIst, utcToIst } from "../../shared/time";
import {
  ADULT_LOWER, ADULT_UPPER, blank, CHILD_LOWER, CHILD_UPPER, codeOf, complete, CONDITIONS, lookOf, PLAN_NAMES, PLANS,
  parseTeeth, sittings, toothName, type PlanName, type ToothState,
} from "../../shared/teeth";

type Event = { id: string; tooth: number; text: string; createdAt: string };
export type Dentition = "adult" | "child";

/** The two rows of teeth. Used by the chart on the record and by the picker in the visit note. */
export function ToothGrid({ dent, state, selected, onPick, compact = false }: {
  dent: Dentition; state: (n: number) => ToothState; selected: number[]; onPick: (n: number) => void; compact?: boolean;
}) {
  const [upper, lower] = dent === "adult" ? [ADULT_UPPER, ADULT_LOWER] : [CHILD_UPPER, CHILD_LOWER];
  const tile = (n: number) => {
    const t = state(n);
    const on = selected.includes(n);
    const plan = t.plan ? `, ${PLANS[t.plan].label} ${t.done} of ${sittings(t)} sittings` : "";
    return (
      <button key={n} type="button" className={`tooth look-${lookOf(t)}${on ? " on" : ""}`} aria-pressed={on}
        aria-label={`Tooth ${n}, ${toothName(n)}, ${t.condition}${plan}`} onClick={() => onPick(n)}>
        <b className="nums">{n}</b>{!compact && <span>{codeOf(t) || "·"}</span>}
      </button>
    );
  };
  return (
    <div className={"tooth-scroll" + (compact ? " compact" : "")}>
      <div className={`tooth-grid ${dent}`}>
        <div className="tooth-side"><span>UPPER RIGHT</span><span>UPPER LEFT</span></div>
        <div className="tooth-row">{upper.map(tile)}</div>
        <div className="tooth-mid" aria-hidden="true" />
        <div className="tooth-row">{lower.map(tile)}</div>
        <div className="tooth-side"><span>LOWER RIGHT</span><span>LOWER LEFT</span></div>
      </div>
    </div>
  );
}

export function DentitionSwitch({ dent, onChange }: { dent: Dentition; onChange: (d: Dentition) => void }) {
  return (
    <div className="seg small" role="group" aria-label="Teeth">
      <button type="button" aria-pressed={dent === "adult"} onClick={() => onChange("adult")}>Adult</button>
      <button type="button" aria-pressed={dent === "child"} onClick={() => onChange("child")}>Child</button>
    </div>
  );
}

const VISIT_FOR: Record<PlanName, string> = { Filling: "Filling", RCT: "Root canal", Crown: "Crown / bridge", Extraction: "Extraction", Implant: "Review" };

/** The tooth chart, treatment plan and tooth history on the patient record. */
export function ToothChart({ patient }: { patient: Patient }) {
  const { settings } = useClinic();
  const toast = useToast();
  const age = patient.birthYear ? new Date().getFullYear() - patient.birthYear : null;
  const [dent, setDent] = useState<Dentition>(age !== null && age < 12 ? "child" : "adult");
  const [teeth, setTeeth] = useState<Map<number, ToothState>>(new Map());
  const [events, setEvents] = useState<Event[]>([]);
  const [sel, setSel] = useState<number>(age !== null && age < 12 ? 75 : 16);
  /** With "Select several" on, the teeth picked so far. Changes then apply to all of them. */
  const [many, setMany] = useState<number[] | null>(null);
  const [err, setErr] = useState("");
  const [booking, setBooking] = useState<PlanName | null>(null);
  const [billing, setBilling] = useState<ToothState | null>(null);

  const load = () => api<{ teeth: ToothState[]; events: Event[] }>(`/patients/${patient.id}/teeth`)
    .then((r) => { setTeeth(new Map(r.teeth.map((t) => [t.tooth, t]))); setEvents(r.events); })
    .catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [patient.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const get = (n: number) => teeth.get(n) ?? blank(n);
  const priceOf = (p: PlanName) => settings.services.find((x) => x.name.toLowerCase() === PLANS[p].service.toLowerCase())?.paise ?? null;

  async function change(n: number, body: Record<string, unknown>, say?: string) {
    setErr("");
    try {
      const r = await api<{ tooth: ToothState; before: ToothState }>(`/patients/${patient.id}/teeth/${n}`, { method: "PUT", body: JSON.stringify(body) });
      await load();
      if (say) toast({ title: say, onUndo: async () => { await api(`/patients/${patient.id}/teeth/${n}`, { method: "PUT", body: JSON.stringify({ restore: r.before }) }); await load(); } });
    } catch (e) { setErr((e as Error).message); }
  }

  /** Applies the same change to several teeth, with one undo for all of them. */
  async function changeAll(ns: number[], body: Record<string, unknown>, say: string) {
    if (ns.length === 1) return change(ns[0]!, body, say);
    setErr("");
    const befores: ToothState[] = [];
    try {
      for (const n of ns) {
        const r = await api<{ before: ToothState }>(`/patients/${patient.id}/teeth/${n}`, { method: "PUT", body: JSON.stringify(body) });
        befores.push(r.before);
      }
    } catch (e) { setErr((e as Error).message); }
    await load();
    if (befores.length) toast({ title: say, onUndo: async () => {
      for (const b of befores) await api(`/patients/${patient.id}/teeth/${b.tooth}`, { method: "PUT", body: JSON.stringify({ restore: b }) });
      await load();
    } });
  }
  const picked = many ?? [sel];
  const pickTooth = (n: number) => {
    if (!many) return setSel(n);
    setMany(many.includes(n) ? many.filter((x) => x !== n) : [...many, n].sort((a, b) => a - b));
    setSel(n);
  };
  const allHave = (f: (t: ToothState) => boolean) => picked.length > 0 && picked.every((n) => f(get(n)));
  const who = picked.length === 1 ? `Tooth ${picked[0]}` : `${picked.length} teeth (${picked.join(", ")})`;

  const s = get(sel);
  const planned = [...teeth.values()].filter((t) => t.plan).sort((a, b) => a.tooth - b.tooth);
  let total = 0, doneValue = 0;
  for (const t of planned) { const p = priceOf(t.plan!) ?? 0; total += p; if (complete(t)) doneValue += p; }
  const toBill = planned.filter((t) => complete(t) && !t.billed);
  const selEvents = events.filter((e) => e.tooth === sel);

  return (
    <div className="chart-layout">
      <section className="chart-main">
        <div className="card">
          <div className="card-head">
            <div><h2>Tooth chart</h2><span className="muted">Tap a tooth to see and change it</span></div>
            <div className="row-actions">
              <label className="check small"><input type="checkbox" checked={!!many} onChange={(e) => setMany(e.target.checked ? [] : null)} /> Select several</label>
              <DentitionSwitch dent={dent} onChange={(d) => { setDent(d); setSel(d === "adult" ? 16 : 75); if (many) setMany([]); }} />
            </div>
          </div>
          {many && <p className="multi-hint">Tap each tooth to add or remove it, then choose a condition or plan on the right. {many.length > 0 && <button type="button" className="link-btn" onClick={() => setMany([])}>Clear selection</button>}</p>}
          <ToothGrid dent={dent} state={get} selected={picked} onPick={pickTooth} />
          <div className="tooth-legend">
            <span><i className="look-problem" />Problem</span><span><i className="look-planned" />Planned</span>
            <span><i className="look-done" />Done</span><span><i className="look-missing" />Missing</span>
            <span className="muted">C caries · P pulpitis · F fracture · RCT root canal · Cr crown · Fill filling · Ext extraction · Imp implant</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Treatment plan</h2>
            <span className="muted">Built from the chart. Bill each treatment once it’s done.</span>
          </div>
          {planned.length === 0 ? <p className="muted">No treatment planned. Pick a tooth and choose a plan.</p> : (
            <div className="table-wrap">
              <table className="plan-table">
                <thead><tr><th>Tooth</th><th>Treatment</th><th>Sittings</th><th>Status</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {planned.map((t) => {
                    const p = priceOf(t.plan!);
                    const st = t.billed ? ["Billed", "s-done"] : complete(t) ? ["Done", "s-in_chair"] : t.done ? ["In progress", "s-arrived"] : ["Planned", "s-booked"];
                    return (
                      <tr key={t.tooth} className={t.tooth === sel ? "on" : ""}>
                        <td><button type="button" className="link-btn nums" onClick={() => { setSel(t.tooth); setDent(t.tooth > 50 ? "child" : "adult"); }}>{t.tooth}</button></td>
                        <td>{PLANS[t.plan!].label}</td>
                        <td className="nums">{t.done} of {sittings(t)}</td>
                        <td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
                        <td className="num nums">{p === null ? <span className="muted">Add to price list</span> : rupees(p)}</td>
                        <td className="num">{complete(t) && !t.billed && <button type="button" className="btn small" onClick={() => setBilling(t)}>Bill</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {planned.length > 0 && (
            <p className="plan-total nums">Plan total <b>{rupees(total)}</b> · Done {rupees(doneValue)}{toBill.length > 0 && <> · <span className="due">{toBill.length} to bill</span></>}</p>
          )}
        </div>
      </section>

      <aside className="chart-side">
        <div className="card tooth-panel">
          {picked.length === 1
            ? <div className="card-head"><h2>Tooth {picked[0]}</h2><span className="muted">{toothName(picked[0]!)}</span></div>
            : <div className="card-head"><h2>{picked.length ? `${picked.length} teeth selected` : "No teeth selected"}</h2><span className="muted nums">{picked.join(", ")}</span></div>}
          {err && <p className="error" role="alert">{err}</p>}
          <fieldset className="field"><legend>Condition</legend>
            <div className="chips">
              {CONDITIONS.map((c) => (
                <button key={c} type="button" disabled={!picked.length} aria-pressed={allHave((t) => t.condition === c)} className={"chip dark" + (allHave((t) => t.condition === c) ? " on" : "")}
                  onClick={() => changeAll(picked, { condition: c }, `${who}: ${c.toLowerCase()}`)}>{c}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field"><legend>Plan</legend>
            <div className="chips">
              <button type="button" disabled={!picked.length} aria-pressed={allHave((t) => !t.plan)} className={"chip blue" + (allHave((t) => !t.plan) ? " on" : "")} onClick={() => changeAll(picked, { plan: null }, `${who}: plan removed`)}>None</button>
              {PLAN_NAMES.map((p) => (
                <button key={p} type="button" disabled={!picked.length} aria-pressed={allHave((t) => t.plan === p)} className={"chip blue" + (allHave((t) => t.plan === p) ? " on" : "")}
                  onClick={() => changeAll(picked, { plan: p }, `${who}: ${PLANS[p].label} planned`)}>{p}</button>
              ))}
            </div>
          </fieldset>

          {picked.length === 1 && s.plan && (
            <div className="sittings">
              <div className="sittings-head">
                <b>{PLANS[s.plan].label}{priceOf(s.plan) !== null ? ` · ${rupees(priceOf(s.plan)!)}` : ""}</b>
                <span className="muted nums">Sitting {s.done} of {sittings(s)}</span>
              </div>
              <ol className="steps">
                {PLANS[s.plan].steps.map((label, i) => (
                  <li key={label} className={i < s.done ? "done" : i === s.done ? "next" : ""}>
                    <span className="dot">{i < s.done ? "✓" : i + 1}</span>{label}{i === s.done ? " · next" : ""}
                  </li>
                ))}
              </ol>
              {complete(s) ? (
                <div className="row-actions">
                  <b className="ok">Treatment complete</b>
                  <button type="button" className="link-btn" onClick={() => change(sel, { done: s.done - 1 }, `Tooth ${sel}: last sitting undone`)}>Undo last sitting</button>
                </div>
              ) : (
                <div className="row-actions">
                  <button type="button" className="btn primary" onClick={() => change(sel, { done: s.done + 1 }, `Tooth ${sel}: ${PLANS[s.plan!].steps[s.done]} done`)}>Mark sitting done</button>
                  <button type="button" className="btn" onClick={() => setBooking(s.plan)}>{s.done === 0 ? "Book first sitting" : "Book next sitting"}</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2>History of tooth {sel}</h2>
          {selEvents.length === 0 ? <p className="muted">Nothing recorded on this tooth yet.</p> : (
            <ul className="history">
              {selEvents.map((e) => {
                const t = utcToIst(e.createdAt);
                return <li key={e.id}><span className="muted">{t.day === todayIst() ? "Today" : dayLabel(t.day, { day: "numeric", month: "short", year: "numeric" })}, {label12(t.time)}</span>{e.text}</li>;
              })}
            </ul>
          )}
        </div>
      </aside>

      {booking && (
        <BookDialog day={todayIst()} patient={patient} visitType={VISIT_FOR[booking]} note={`Tooth ${sel} · ${PLANS[booking].label} sitting ${s.done + 1} of ${sittings(s)}`}
          onClose={() => setBooking(null)} onSaved={(msg) => { setBooking(null); toast({ title: msg }); }} />
      )}
      {billing && (
        <NewBill patient={patient}
          lines={[{ service: PLANS[billing.plan!].service, tooth: String(billing.tooth), amount: String((priceOf(billing.plan!) ?? 0) / 100) }]}
          onClose={() => setBilling(null)}
          onSaved={async (msg, receiptId) => {
            const t = billing; setBilling(null);
            await change(t.tooth, { billed: true });
            toast({ title: msg });
            if (receiptId) printReceipt(receiptId);
          }} />
      )}
    </div>
  );
}

/** The visit note's tooth box, with a chart to tap teeth in and out. */
export function ToothPicker({ patientId, value, onChange, disabled }: { patientId: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [dent, setDent] = useState<Dentition>("adult");
  const [teeth, setTeeth] = useState<Map<number, ToothState>>(new Map());
  useEffect(() => {
    if (!open) return;
    api<{ teeth: ToothState[] }>(`/patients/${patientId}/teeth`).then((r) => setTeeth(new Map(r.teeth.map((t) => [t.tooth, t])))).catch(() => {});
  }, [open, patientId]);
  const picked = parseTeeth(value);
  useEffect(() => { if (picked.some((n) => n > 50) && !picked.some((n) => n < 50)) setDent("child"); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (n: number) => onChange((picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]).join(", "));
  return (
    <div className="field">
      <label htmlFor="visit-tooth">Tooth</label>
      <div className="input-with-btn">
        <input id="visit-tooth" className="input" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. 16, or 36 37" />
        {!disabled && <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close chart" : "Pick on chart"}</button>}
      </div>
      {open && !disabled && (
        <div className="tooth-pick">
          <div className="card-head">
            <span className="muted">Tap teeth to add or remove them. Colours show the patient’s chart.</span>
            <DentitionSwitch dent={dent} onChange={setDent} />
          </div>
          <ToothGrid dent={dent} compact state={(n) => teeth.get(n) ?? blank(n)} selected={picked} onPick={toggle} />
        </div>
      )}
    </div>
  );
}
