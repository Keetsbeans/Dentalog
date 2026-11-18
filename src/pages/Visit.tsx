import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Food, type RxItem, type VisitBundle } from "../lib/api";
import { useToast } from "../components/Toast";
import { findDrug as findIn, penicillinAllergy } from "../../shared/drugs";
import { useClinic } from "../lib/clinic";
import { directions } from "../../shared/rx";
import { label12, utcToIst } from "../../shared/time";
import { dayLabel } from "../components/Appointments";
import { NewBill, printReceipt } from "../components/Billing";
import { ToothPicker } from "../components/ToothChart";
import { Addenda } from "../components/Addenda";

const FINDINGS = ["Deep caries", "Tender on percussion", "Periapical widening on IOPA", "Mobility grade I", "Swelling", "Fractured cusp", "Calculus", "Bleeding gums"];
const DIAGNOSES = ["Irreversible pulpitis", "Reversible pulpitis", "Dental caries", "Periapical abscess", "Gingivitis", "Chronic periodontitis", "Cracked tooth", "Impacted tooth"];
const ADVICE = ["Avoid chewing on that side", "Warm salt-water rinse", "Soft food for 24 hours", "No smoking for 48 hours", "Don’t spit or rinse today", "Call if swelling or fever"];
const NEXT = ["In 3 days", "In about a week", "In 2 weeks", "In 6 months (cleaning)", "Only if needed"];
const DOSES = ["1-0-0", "0-0-1", "1-0-1", "1-1-1", "SOS"];
const DAYS = [3, 5, 7];

type Draft = Omit<VisitBundle["visit"], "id" | "patientId" | "appointmentId" | "createdAt" | "signedAt">;

export function Visit() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { settings } = useClinic();
  const findDrug = (n: string) => findIn(n, settings.drugs);
  const [data, setData] = useState<VisitBundle | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<RxItem[]>([]);
  const [overrides, setOverrides] = useState<string[]>([]);
  const [saved, setSaved] = useState<string>("");
  const [error, setError] = useState("");
  const [drugQ, setDrugQ] = useState("");
  const dirty = useRef(false);
  const [billing, setBilling] = useState(false);

  useEffect(() => {
    api<VisitBundle>(`/visits/${id}`).then((r) => {
      setData(r); setItems(r.items);
      const { id: _i, patientId: _p, appointmentId: _a, createdAt: _c, signedAt: _s, ...rest } = r.visit;
      setDraft(rest);
    }).catch((e) => setError((e as Error).message));
  }, [id]);

  const locked = !!data?.visit.signedAt;

  // Draft saves itself a moment after each change.
  useEffect(() => {
    if (!draft || locked || !dirty.current) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ savedAt: string }>(`/visits/${id}`, { method: "PUT", body: JSON.stringify({ ...draft, items }) });
        setSaved(label12(utcToIst(r.savedAt).time)); setError(""); dirty.current = false;
      } catch (e) { setError((e as Error).message); }
    }, 900);
    return () => clearTimeout(t);
  }, [draft, items, id, locked]);

  if (error && !data) return <p className="error" role="alert">{error}</p>;
  if (!data || !draft) return <p className="empty">Loading…</p>;
  const { patient } = data;

  const edit = (patch: Partial<Draft>) => { if (locked) return; dirty.current = true; setDraft({ ...draft, ...patch }); };
  const toggle = (key: "findings" | "diagnosis" | "advice", v: string) =>
    edit({ [key]: draft[key].includes(v) ? draft[key].filter((x) => x !== v) : [...draft[key], v] });
  const setItem = (i: number, patch: Partial<RxItem>) => { if (locked) return; dirty.current = true; setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x))); };
  const addDrugs = (names: string[]) => {
    if (locked) return;
    const fresh = names.filter((n) => !items.some((i) => i.drug === n));
    if (!fresh.length) return;
    dirty.current = true;
    setItems([...items, ...fresh.map((n) => {
      const d = findDrug(n);
      return d ? { drug: d.name, generic: d.generic, dose: d.dose, days: d.days, food: d.food } : { drug: n, generic: null, dose: "1-0-1", days: 5, food: "after" as Food };
    })]);
    setDrugQ("");
  };

  const diabetic = patient.alerts.includes("Diabetic");
  const sugarMissing = diabetic && !draft.vitals.sugar?.trim();
  const allergy = penicillinAllergy(patient.alerts);
  const clashes = items.filter((i) => allergy && findDrug(i.drug)?.penicillin && !overrides.includes(i.drug));
  const drugMatches = drugQ.trim() ? settings.drugs.filter((d) => (d.name + d.generic).toLowerCase().includes(drugQ.trim().toLowerCase())).slice(0, 6) : [];

  async function sign() {
    setError("");
    try {
      await api(`/visits/${id}`, { method: "PUT", body: JSON.stringify({ ...draft, items }) });
      const r = await api<{ signedAt: string }>(`/visits/${id}/sign`, { method: "POST", body: JSON.stringify({ allergyOverride: overrides.length > 0 }) });
      dirty.current = false;
      setData({ ...data!, visit: { ...data!.visit, signedAt: r.signedAt } });
      toast({ title: "Note signed. The prescription is ready to print." });
    } catch (e) { setError((e as Error).message); }
  }

  const chip = (on: boolean, cls = "teal") => "chip " + cls + (on ? " on" : "");
  const when = utcToIst(data.visit.createdAt);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link to={`/patients/${patient.id}`}>{patient.name}</Link> · {patient.code} · {dayLabel(when.day)}, {label12(when.time)}</p>
          <h1>Visit note</h1>
        </div>
        <div className="head-actions">
          <span className="muted">{locked ? `Signed ${dayLabel(utcToIst(data.visit.signedAt!).day)}` : saved ? `Draft saved ${saved}` : "Draft saves as you type"}</span>
          {locked
            ? <button type="button" className="btn primary" onClick={() => window.open(`/print/rx/${id}`, "_blank")}>Print prescription</button>
            : <button type="button" className={"btn " + (sugarMissing || clashes.length ? "" : "primary")} onClick={sign}>Sign note</button>}
        </div>
      </div>
      {patient.alerts.length > 0 && <div className="alert-bar" role="note"><b>Medical alerts:</b> {patient.alerts.join(" · ")}</div>}
      {error && <p className="error" role="alert">{error}</p>}
      {locked && <p className="note-locked">This note is signed and locked. Add anything new as an addendum at the bottom.</p>}

      <div className="visit-grid">
        <section className="card stack">
          <h2>Today</h2>
          <div className="row3">
            <label className="field">BP<input className="input nums" disabled={locked} value={draft.vitals.bp ?? ""} onChange={(e) => edit({ vitals: { ...draft.vitals, bp: e.target.value } })} placeholder="120/80" /></label>
            <label className="field">Sugar (mg/dL){diabetic && <span className="req">needed</span>}
              <input className={"input nums" + (sugarMissing && !locked ? " need" : "")} disabled={locked} inputMode="numeric" value={draft.vitals.sugar ?? ""} onChange={(e) => edit({ vitals: { ...draft.vitals, sugar: e.target.value.replace(/\D/g, "").slice(0, 3) } })} />
            </label>
            <label className="field">Pulse<input className="input nums" disabled={locked} inputMode="numeric" value={draft.vitals.pulse ?? ""} onChange={(e) => edit({ vitals: { ...draft.vitals, pulse: e.target.value.replace(/\D/g, "").slice(0, 3) } })} /></label>
          </div>
          {Number(draft.vitals.sugar) > 250 && <p className="warn">Sugar is above 250. Consider postponing surgical work.</p>}
          <label className="field">Complaint<textarea className="input area" disabled={locked} value={draft.complaint ?? ""} onChange={(e) => edit({ complaint: e.target.value })} placeholder="e.g. Pain upper right back tooth for 3 days" /></label>
          <ToothPicker patientId={patient.id} disabled={locked} value={draft.tooth ?? ""} onChange={(v) => edit({ tooth: v })} />
          <fieldset className="field"><legend>Findings</legend>
            <div className="chips">{FINDINGS.map((f) => <button key={f} type="button" disabled={locked} aria-pressed={draft.findings.includes(f)} className={chip(draft.findings.includes(f), "dark")} onClick={() => toggle("findings", f)}>{f}</button>)}</div>
          </fieldset>
          <fieldset className="field"><legend>Diagnosis</legend>
            <div className="chips">{DIAGNOSES.map((f) => <button key={f} type="button" disabled={locked} aria-pressed={draft.diagnosis.includes(f)} className={chip(draft.diagnosis.includes(f), "blue")} onClick={() => toggle("diagnosis", f)}>{f}</button>)}</div>
          </fieldset>
          <label className="field">Treatment notes<textarea className="input area tall" disabled={locked} value={draft.notes ?? ""} onChange={(e) => edit({ notes: e.target.value })} placeholder="What was done today" /></label>
        </section>

        <section className="card stack">
          <h2>Prescription</h2>
          {!locked && (
            <>
              <div className="chips">{Object.entries(settings.sets).map(([k, v]) => <button key={k} type="button" className="chip" onClick={() => addDrugs(v)}>+ {k}</button>)}</div>
              <div className="field">
                <label htmlFor="drug-q" className="sr-only">Add a medicine</label>
                <input id="drug-q" className="input" value={drugQ} onChange={(e) => setDrugQ(e.target.value)} placeholder="Add a medicine" autoComplete="off"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDrugs([drugMatches[0]?.name ?? drugQ.trim()]); } }} />
                {drugQ.trim() && (
                  <ul className="picklist">
                    {drugMatches.map((d) => <li key={d.name}><button type="button" onClick={() => addDrugs([d.name])}><b>{d.name}</b> <span className="muted">{d.generic}</span></button></li>)}
                    {!findDrug(drugQ) && <li><button type="button" onClick={() => addDrugs([drugQ.trim()])}>Add “{drugQ.trim()}”</button></li>}
                  </ul>
                )}
              </div>
            </>
          )}
          {items.length === 0 && <p className="empty">No medicines. Add one, or pick a set above.</p>}
          {items.map((it, i) => {
            const d = findDrug(it.drug);
            const warn = clashes.includes(it);
            let text = "";
            try { text = directions(it.dose, it.days, it.food); } catch { text = "Choose a dose"; }
            return (
              <div key={i} className={"rx" + (warn ? " warn-box" : "")}>
                <div className="rx-head">
                  <div><b>{it.drug}</b>{it.generic && <div className="muted">{it.generic}</div>}</div>
                  {!locked && <button type="button" className="icon-btn" aria-label={`Remove ${it.drug}`} onClick={() => { dirty.current = true; setItems(items.filter((_, n) => n !== i)); }}>×</button>}
                </div>
                {warn && (
                  <div className="rx-warn" role="alert">
                    <b>Penicillin allergy recorded.</b> {it.drug} contains amoxicillin.
                    <div className="chips">
                      {d?.swap && <button type="button" className="btn small" onClick={() => { const s = findDrug(d.swap!)!; setItem(i, { drug: s.name, generic: s.generic, dose: s.dose, days: s.days, food: s.food }); }}>Switch to {d.swap}</button>}
                      <button type="button" className="btn small" onClick={() => setOverrides([...overrides, it.drug])}>Prescribe anyway</button>
                    </div>
                  </div>
                )}
                {!locked && (
                  <div className="rx-pick">
                    <div className="chips">{DOSES.map((x) => <button key={x} type="button" aria-pressed={it.dose === x} className={"dose" + (it.dose === x ? " on" : "")} onClick={() => setItem(i, { dose: x })}>{x}</button>)}</div>
                    <div className="chips">
                      {DAYS.map((x) => <button key={x} type="button" aria-pressed={it.days === x} className={"dose" + (it.days === x ? " on" : "")} onClick={() => setItem(i, { days: x })}>{x} days</button>)}
                      <label className="days-other"><span className="sr-only">Other number of days</span><input className="input nums" inputMode="numeric" value={DAYS.includes(it.days ?? 0) ? "" : it.days ?? ""} placeholder="days" onChange={(e) => setItem(i, { days: Number(e.target.value.replace(/\D/g, "")) || null })} /></label>
                    </div>
                    <div className="chips">{(["after", "before", "any"] as Food[]).map((x) => <button key={x} type="button" aria-pressed={it.food === x} className={"dose" + (it.food === x ? " on" : "")} onClick={() => setItem(i, { food: x })}>{x === "any" ? "Any time" : x === "after" ? "After food" : "Before food"}</button>)}</div>
                  </div>
                )}
                <p className="rx-text"><b className="nums">{it.dose}{it.days ? ` × ${it.days}d` : ""}</b> · {text}</p>
              </div>
            );
          })}

          <fieldset className="field"><legend>Advice</legend>
            <div className="chips">{ADVICE.map((a) => <button key={a} type="button" disabled={locked} aria-pressed={draft.advice.includes(a)} className={chip(draft.advice.includes(a))} onClick={() => toggle("advice", a)}>{a}</button>)}</div>
          </fieldset>
          <label className="field">More advice<input className="input" disabled={locked} value={draft.adviceNote ?? ""} onChange={(e) => edit({ adviceNote: e.target.value })} /></label>
          <fieldset className="field"><legend>Next visit</legend>
            <div className="chips">{NEXT.map((a) => <button key={a} type="button" disabled={locked} aria-pressed={draft.nextVisit === a} className={chip(draft.nextVisit === a)} onClick={() => edit({ nextVisit: draft.nextVisit === a ? null : a })}>{a}</button>)}</div>
            <input className="input" disabled={locked} value={draft.nextVisit ?? ""} onChange={(e) => edit({ nextVisit: e.target.value })} placeholder="Or type, e.g. Fri 6 PM · RCT sitting 2" />
          </fieldset>
          {!locked && (sugarMissing || clashes.length > 0) && (
            <p className="warn">{sugarMissing ? "Add today’s blood sugar before signing (diabetic patient)." : "Resolve the allergy warning before signing."}</p>
          )}
          {locked && (
            <div className="chips">
              <button type="button" className="btn primary" onClick={() => setBilling(true)}>Make the bill</button>
              <button type="button" className="btn" onClick={() => nav(`/patients/${patient.id}`)}>Back to {patient.name}</button>
            </div>
          )}
        </section>
      </div>
      {locked && <Addenda visitId={id!} items={data.addenda} onAdded={(a) => setData({ ...data, addenda: [...data.addenda, a] })} />}
      {billing && <NewBill patient={patient} onClose={() => setBilling(false)} onSaved={(msg, receiptId) => { setBilling(false); toast({ title: msg }); if (receiptId) printReceipt(receiptId); }} />}
    </>
  );
}
