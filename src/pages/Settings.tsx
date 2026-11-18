import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Account, Channels, Holidays, PictureField, Printouts, SheetPreview, YourData } from "./SettingsExtra";
import { api, type Clinic } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { toPaise } from "../components/Billing";
import type { DayKey, Hours } from "../../shared/time";
import { directions, type Food } from "../../shared/rx";
import type { ClinicSettings } from "../../shared/settings";

type Tab = "clinic" | "hours" | "prices" | "medicines" | "labs" | "messages" | "printouts" | "account" | "data";
const TABS: [Tab, string][] = [
  ["clinic", "Clinic details"], ["hours", "Hours and holidays"], ["prices", "Price list"], ["medicines", "Medicines"], ["labs", "Dental labs"],
  ["messages", "Messages"], ["printouts", "Printouts"], ["account", "Account"], ["data", "Your data"],
];
/** Tabs that only show things, so there is nothing to save on them. */
const VIEW_ONLY: Tab[] = ["messages", "account", "data"];
const DAY_NAME: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const WEEK: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type Details = Pick<Clinic, "name" | "doctorName" | "qualification" | "phone" | "address" | "email" | "website" | "upiId">;
/** Prices are edited as rupee text so a half-typed number doesn't jump around. */
type Draft = { details: Details; hours: Hours; settings: ClinicSettings; prices: string[] };

function fromClinic(c: Clinic, hours: Hours, settings: ClinicSettings): Draft {
  return {
    details: { name: c.name, doctorName: c.doctorName, qualification: c.qualification, phone: c.phone, address: c.address, email: c.email, website: c.website, upiId: c.upiId },
    hours: { ...hours }, settings: structuredClone(settings), prices: settings.services.map((x) => String(x.paise / 100)),
  };
}

export function Settings() {
  const { clinic, hours, settings, reload } = useClinic();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find(([t]) => t === params.get("tab"))?.[0] ?? "clinic";
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [previewDoc, setPreviewDoc] = useState<"rx" | "receipt">("rx");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (clinic && !dirty) setDraft(fromClinic(clinic, hours, settings)); }, [clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!clinic || !draft) return <p className="empty">Loading…</p>;

  const up = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setDirty(true); setErr(""); };
  const det = (k: keyof Details, v: string) => up({ details: { ...draft.details, [k]: v } });
  const st = (patch: Partial<ClinicSettings>) => up({ settings: { ...draft.settings, ...patch } });

  async function save() {
    setBusy(true); setErr("");
    try {
      const S = draft!.settings;
      // Blank rows are dropped rather than refused.
      const clean: ClinicSettings = {
        services: S.services.map((x, i) => ({ ...x, name: x.name.trim(), group: x.group?.trim() || undefined, paise: toPaise(draft!.prices[i] ?? "") ?? 0 })).filter((x) => x.name),
        drugs: S.drugs.map((d) => ({ ...d, name: d.name.trim(), generic: d.generic.trim(), dose: d.dose.trim().toUpperCase() })).filter((d) => d.name),
        sets: Object.fromEntries(Object.entries(S.sets).map(([k, v]) => [k.trim(), v.map((x) => x.trim()).filter(Boolean)] as const).filter(([k]) => k)),
        visitTypes: S.visitTypes.map((v) => ({ ...v, name: v.name.trim() })).filter((v) => v.name),
        labs: S.labs.map((l) => ({ ...l, name: l.name.trim() })).filter((l) => l.name),
        labWork: S.labWork.map((x) => x.trim()).filter(Boolean),
        templates: S.templates,
        soonMinutes: S.soonMinutes,
        reviewLink: S.reviewLink,
        holidays: S.holidays,
        print: S.print,
      };
      await api("/clinic", { method: "PUT", body: JSON.stringify({ ...draft!.details, hours: draft!.hours, settings: clean }) });
      await reload(); setDirty(false);
      toast({ title: "Settings saved." });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const D = draft.details;
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        {dirty && (
          <div className="head-actions">
            <span className="muted">Unsaved changes</span>
            <button type="button" className="btn" onClick={() => { setDraft(fromClinic(clinic, hours, settings)); setDirty(false); setErr(""); }}>Discard</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        )}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === "clinic" && (
        <section className="card stack">
          <p className="muted">Shown in the menu and on prescriptions and receipts.</p>
          <div className="row2">
            <label className="field">Clinic name<input className="input" value={D.name} onChange={(e) => det("name", e.target.value)} /></label>
            <label className="field">Doctor’s name<input className="input" value={D.doctorName} onChange={(e) => det("doctorName", e.target.value)} /></label>
            <label className="field">Qualification<input className="input" value={D.qualification ?? ""} onChange={(e) => det("qualification", e.target.value)} placeholder="BDS" /></label>
            <label className="field">Phone / WhatsApp<input className="input" value={D.phone ?? ""} onChange={(e) => det("phone", e.target.value)} /></label>
          </div>
          <label className="field">Address<input className="input" value={D.address ?? ""} onChange={(e) => det("address", e.target.value)} /></label>
          <div className="row2">
            <label className="field">Email<input className="input" type="email" value={D.email ?? ""} onChange={(e) => det("email", e.target.value)} /></label>
            <label className="field">Website<input className="input" value={D.website ?? ""} onChange={(e) => det("website", e.target.value)} /></label>
            <label className="field">UPI ID (printed on receipts)<input className="input" value={D.upiId ?? ""} onChange={(e) => det("upiId", e.target.value)} placeholder="name@okhdfcbank" /></label>
          </div>
        </section>
      )}
      {tab === "clinic" && (
        <div className="visit-grid clinic-pics">
          <section className="card stack">
            <h2>Logo</h2>
            <PictureField kind="logo" hint="Shown next to your clinic name in the menu. A square picture works best." />
            <h2>Letterhead</h2>
            <PictureField kind="letterhead" hint="Your heading as a PDF or picture. Upload “Prescription Heading” here to replace it." />
            <p className="muted">Spacing, signature, paper size and what to show are under <button type="button" className="link-btn inline" onClick={() => setTab("printouts")}>Printouts</button>.</p>
          </section>
          <section className="card stack">
            <div className="card-head">
              <h2>Letterhead preview</h2>
              <div className="seg small" role="group" aria-label="Which printout">
                <button type="button" aria-pressed={previewDoc === "rx"} onClick={() => setPreviewDoc("rx")}>Prescription</button>
                <button type="button" aria-pressed={previewDoc === "receipt"} onClick={() => setPreviewDoc("receipt")}>Receipt</button>
              </div>
            </div>
            <SheetPreview clinic={clinic} layout={draft.settings.print} doc={previewDoc} />
            <a className="btn" href="/print/rx/test" target="_blank" rel="noopener noreferrer">Open full size</a>
          </section>
        </div>
      )}

      {tab === "hours" && (
        <div className="visit-grid">
          <section className="card stack">
            <h2>Opening hours</h2>
            {WEEK.map((d) => {
              const h = draft.hours[d];
              return (
                <div key={d} className="hours-row">
                  <label className="check"><input type="checkbox" checked={!!h} onChange={(e) => up({ hours: { ...draft.hours, [d]: e.target.checked ? ["15:30", "20:30"] : null } })} /> {DAY_NAME[d]}</label>
                  {h ? (
                    <span className="hours-times">
                      <label><span className="sr-only">{DAY_NAME[d]} opens</span><input type="time" className="input" value={h[0]} onChange={(e) => up({ hours: { ...draft.hours, [d]: [e.target.value, h[1]] } })} /></label>
                      <span aria-hidden="true">to</span>
                      <label><span className="sr-only">{DAY_NAME[d]} closes</span><input type="time" className="input" value={h[1]} onChange={(e) => up({ hours: { ...draft.hours, [d]: [h[0], e.target.value] } })} /></label>
                    </span>
                  ) : <span className="muted">Closed</span>}
                </div>
              );
            })}
          </section>
          <section className="card stack">
            <h2>Visit types</h2>
            <p className="muted">The usual length when you book. You can still change it on each booking.</p>
            {draft.settings.visitTypes.map((v, i) => (
              <div key={i} className="bill-line">
                <label className="field grow"><span className="sr-only">Visit type</span><input className="input" value={v.name} onChange={(e) => st({ visitTypes: draft.settings.visitTypes.map((x, n) => n === i ? { ...x, name: e.target.value } : x) })} /></label>
                <label className="field amt"><span className="sr-only">Minutes</span>
                  <select className="input" value={v.minutes} onChange={(e) => st({ visitTypes: draft.settings.visitTypes.map((x, n) => n === i ? { ...x, minutes: Number(e.target.value) } : x) })}>
                    {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </label>
                <button type="button" className="icon-btn" aria-label={`Remove ${v.name}`} onClick={() => st({ visitTypes: draft.settings.visitTypes.filter((_, n) => n !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => st({ visitTypes: [...draft.settings.visitTypes, { name: "", minutes: 30 }] })}>+ Add visit type</button>
          </section>
          <Holidays list={draft.settings.holidays} onChange={(holidays) => st({ holidays })} />
        </div>
      )}

      {tab === "prices" && (
        <section className="card stack">
          <p className="muted">These fill in when you make a bill, and you can still change them there. No GST is added. Groups (like Endodontics or Prosthodontics) keep the list tidy.</p>
          <div className="bill-line price-head muted" aria-hidden="true"><span className="grow">Service</span><span className="group">Group</span><span className="amt right">Price (₹)</span><span className="icon-pad" /></div>
          <datalist id="price-groups">{[...new Set(["Consultation", "Preventive", "Restorative", "Endodontics", "Periodontics", "Prosthodontics", "Surgery", "Orthodontics", "Implants", "Cosmetic", ...draft.settings.services.map((s) => s.group ?? "").filter(Boolean)])].map((g) => <option key={g} value={g} />)}</datalist>
          {draft.settings.services.map((x, i) => (
            <div key={i} className="bill-line">
              <label className="field grow"><span className="sr-only">Service</span><input className="input" value={x.name} onChange={(e) => st({ services: draft.settings.services.map((y, n) => n === i ? { ...y, name: e.target.value } : y) })} /></label>
              <label className="field group"><span className="sr-only">Group</span><input className="input" list="price-groups" value={x.group ?? ""} placeholder="Group" onChange={(e) => st({ services: draft.settings.services.map((y, n) => n === i ? { ...y, group: e.target.value } : y) })} /></label>
              <label className="field amt"><span className="sr-only">Price in rupees</span><input className="input nums right" inputMode="decimal" value={draft.prices[i] ?? ""} placeholder="₹" onChange={(e) => up({ prices: draft.prices.map((p, n) => n === i ? e.target.value : p) })} /></label>
              <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => up({ settings: { ...draft.settings, services: draft.settings.services.filter((_, n) => n !== i) }, prices: draft.prices.filter((_, n) => n !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => up({ settings: { ...draft.settings, services: [...draft.settings.services, { name: "", paise: 0 }] }, prices: [...draft.prices, ""] })}>+ Add service</button>
          <p className="muted">A price of 0 asks you to type the amount on each bill (useful for medicines or variable work).</p>
        </section>
      )}

      {tab === "medicines" && (
        <div className="visit-grid">
          <section className="card stack">
            <h2>Favourite medicines</h2>
            <p className="muted">These show on the prescription pad with their usual course. Tick “Penicillin” so allergy checks catch it.</p>
            {draft.settings.drugs.map((d, i) => {
              const setD = (patch: Partial<typeof d>) => st({ drugs: draft.settings.drugs.map((x, n) => n === i ? { ...x, ...patch } : x) });
              let ok = true; try { directions(d.dose, d.days, d.food); } catch { ok = false; }
              return (
                <div key={i} className="med">
                  <div className="bill-line">
                    <label className="field grow"><span className="sr-only">Brand name</span><input className="input" value={d.name} placeholder="Brand name" onChange={(e) => setD({ name: e.target.value })} /></label>
                    <button type="button" className="icon-btn" aria-label={`Remove ${d.name}`} onClick={() => st({ drugs: draft.settings.drugs.filter((_, n) => n !== i) })}>×</button>
                  </div>
                  <label className="field"><span className="sr-only">What is in it</span><input className="input" value={d.generic} placeholder="What’s in it, e.g. Amoxicillin 500 mg · capsule" onChange={(e) => setD({ generic: e.target.value })} /></label>
                  <div className="med-row">
                    <label className="field">Dose<input className={"input nums" + (ok ? "" : " need")} value={d.dose} onChange={(e) => setD({ dose: e.target.value })} placeholder="1-0-1 or SOS" /></label>
                    <label className="field">Days<input className="input nums" inputMode="numeric" value={d.days} onChange={(e) => setD({ days: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
                    <label className="field">Food
                      <select className="input" value={d.food} onChange={(e) => setD({ food: e.target.value as Food })}><option value="after">After</option><option value="before">Before</option><option value="any">Any time</option></select>
                    </label>
                    <label className="check small"><input type="checkbox" checked={!!d.penicillin} onChange={(e) => setD({ penicillin: e.target.checked })} /> Penicillin</label>
                  </div>
                </div>
              );
            })}
            <button type="button" className="link-btn" onClick={() => st({ drugs: [...draft.settings.drugs, { name: "", generic: "", dose: "1-0-1", days: 5, food: "after" }] })}>+ Add medicine</button>
          </section>
          <section className="card stack">
            <h2>Saved sets</h2>
            <p className="muted">One tap adds the whole set. List the medicine names separated by commas.</p>
            {Object.entries(draft.settings.sets).map(([name, items], i) => (
              <div key={i} className="med">
                <div className="bill-line">
                  <label className="field grow"><span className="sr-only">Set name</span><input className="input" value={name} onChange={(e) => {
                    const entries = Object.entries(draft.settings.sets); entries[i] = [e.target.value, items]; st({ sets: Object.fromEntries(entries) });
                  }} /></label>
                  <button type="button" className="icon-btn" aria-label={`Remove ${name}`} onClick={() => st({ sets: Object.fromEntries(Object.entries(draft.settings.sets).filter((_, n) => n !== i)) })}>×</button>
                </div>
                <label className="field"><span className="sr-only">Medicines in {name}</span><input className="input" value={items.join(", ")} onChange={(e) => st({ sets: { ...draft.settings.sets, [name]: e.target.value.split(",").map((x) => x.trimStart()) } })} /></label>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => st({ sets: { ...draft.settings.sets, [`New set ${Object.keys(draft.settings.sets).length + 1}`]: [] } })}>+ Add set</button>
          </section>
        </div>
      )}

      {tab === "labs" && (
        <section className="card stack">
          <p className="muted">Labs you send work to. “Usually back in” sets the due date on new orders.</p>
          {draft.settings.labs.map((l, i) => {
            const setL = (patch: Partial<typeof l>) => st({ labs: draft.settings.labs.map((x, n) => n === i ? { ...x, ...patch } : x) });
            return (
              <div key={i} className="lab-row">
                <label className="field grow">Lab name<input className="input" value={l.name} onChange={(e) => setL({ name: e.target.value })} /></label>
                <label className="field">Phone<input className="input" value={l.phone ?? ""} onChange={(e) => setL({ phone: e.target.value })} /></label>
                <label className="field amt">Usually back in (days)<input className="input nums" inputMode="numeric" value={l.days || ""} onChange={(e) => setL({ days: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
                <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => st({ labs: draft.settings.labs.filter((_, n) => n !== i) })}>×</button>
              </div>
            );
          })}
          <button type="button" className="link-btn" onClick={() => st({ labs: [...draft.settings.labs, { name: "", days: 7 }] })}>+ Add lab</button>
          <h2>Types of lab work</h2>
          <label className="field"><span className="sr-only">Lab work types, separated by commas</span><input className="input" value={draft.settings.labWork.join(", ")} onChange={(e) => st({ labWork: e.target.value.split(",").map((x) => x.trimStart()) })} /></label>
          <p className="muted">Separated by commas. These are the quick picks on a new lab order.</p>
        </section>
      )}
      {tab === "messages" && <Channels />}
      {tab === "printouts" && <Printouts layout={draft.settings.print} onChange={(print) => st({ print })} />}
      {tab === "account" && <Account />}
      {tab === "data" && <YourData />}
      {dirty && !VIEW_ONLY.includes(tab) && <div className="save-bar"><span>Unsaved changes</span><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button></div>}
    </>
  );
}

