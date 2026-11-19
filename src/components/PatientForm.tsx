import { useState, type FormEvent } from "react";
import { api, type Patient } from "../lib/api";
import { checkPhone, COUNTRY_CODES } from "../../shared/phone";
import { useMe } from "./AuthGate";

export const ALERTS = ["Diabetic", "BP", "Blood thinners", "Penicillin allergy", "Other allergy", "Pregnant", "Heart condition"];

/** Country code plus up to 10 digits. Anything that isn't a digit is dropped as you type. */
export function PhoneInput({ cc, phone, onChange, id, label = "Mobile (WhatsApp)" }: {
  cc: string; phone: string; onChange: (cc: string, phone: string) => void; id: string; label?: string;
}) {
  const problem = phone.length >= 10 || (phone.length > 0 && cc !== "91" && phone.length >= 7) ? checkPhone(cc, phone) : null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="phone-input">
        <select aria-label="Country code" className="input" value={cc} onChange={(e) => onChange(e.target.value, phone)}>
          {COUNTRY_CODES.map(([c, name]) => <option key={c} value={c}>+{c} {name}</option>)}
        </select>
        <input id={id} className="input nums" inputMode="numeric" autoComplete="tel-national" maxLength={10}
          value={phone} onChange={(e) => onChange(cc, e.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder={cc === "91" ? "10 digits" : "Up to 10 digits"} aria-invalid={!!problem} />
      </div>
      {problem ? <span className="field-error">{problem}</span> : <span className="muted">{phone.length}/10 digits</span>}
    </div>
  );
}

type Full = Patient & { notes?: string | null; whatsappConsent?: boolean };

/** Add a new patient, or edit one (pass `patient`). */
export function PatientForm({ patient, onClose, onSaved }: { patient?: Full; onClose: () => void; onSaved: (msg: string, id: string) => void }) {
  const [name, setName] = useState(patient?.name ?? "");
  const [cc, setCc] = useState(patient?.phoneCc ?? "91");
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [email, setEmail] = useState(patient?.email ?? "");
  const [age, setAge] = useState(patient?.birthYear ? String(new Date().getFullYear() - patient.birthYear) : "");
  const [gender, setGender] = useState<"F" | "M" | "O" | "">(patient?.gender ?? "");
  const [alerts, setAlerts] = useState<string[]>(patient?.alerts ?? []);
  const [other, setOther] = useState(patient?.alerts.filter((a) => !ALERTS.includes(a)).join(", ") ?? "");
  const [consent, setConsent] = useState(patient?.whatsappConsent ?? true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Front desk can note alerts on a new patient, but only a doctor changes them afterwards.
  const { can } = useMe();
  const lockAlerts = !!patient && !can("alerts.edit");

  async function save(e: FormEvent) {
    e.preventDefault();
    const bad = checkPhone(cc, phone);
    if (!name.trim()) return setErr("Enter the patient’s name.");
    if (bad) return setErr(bad);
    const a = age.trim() ? Number(age) : null;
    if (a !== null && (!Number.isInteger(a) || a < 0 || a > 110)) return setErr("Check the age.");
    setBusy(true); setErr("");
    const body = {
      name, phoneCc: cc, phone, email: email.trim() || null, gender: gender || null,
      birthYear: a === null ? null : new Date().getFullYear() - a,
      alerts: lockAlerts ? undefined : [...alerts.filter((x) => ALERTS.includes(x)), ...other.split(",").map((x) => x.trim()).filter(Boolean)],
      whatsappConsent: consent,
    };
    try {
      if (patient) {
        await api(`/patients/${patient.id}`, { method: "PUT", body: JSON.stringify(body) });
        onSaved(`${name.trim()}’s details saved.`, patient.id);
      } else {
        const r = await api<{ id: string; code: string }>("/patients", { method: "POST", body: JSON.stringify(body) });
        onSaved(`${name.trim()} added as ${r.code}.`, r.id);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open" onSubmit={save} aria-labelledby="pf-title" noValidate>
        <h2 id="pf-title">{patient ? `Edit ${patient.name}` : "Add patient"}</h2>
        <label className="field">Full name<input className="input" autoFocus={!patient} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <PhoneInput id="pf-phone" cc={cc} phone={phone} onChange={(c, p) => { setCc(c); setPhone(p); }} />
        <label className="field">Email (optional)
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          {patient?.email && patient.email === email.trim().toLowerCase() && (
            <span className={patient.emailConfirmedAt ? "ok-text" : "muted"}>{patient.emailConfirmedAt ? "Confirmed by the patient" : "Not confirmed yet. The patient can confirm it from their appointment link."}</span>
          )}
        </label>
        <div className="row2">
          <label className="field">Age<input className="input nums" inputMode="numeric" maxLength={3} value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field">Gender
            <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "F" | "M" | "O" | "")}>
              <option value="">–</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
            </select>
          </label>
        </div>
        {lockAlerts ? (
          <div className="field"><span>Medical alerts</span>
            <span className="muted">{patient.alerts.length ? patient.alerts.join(" · ") : "None noted"}. Only a doctor can change these.</span>
          </div>
        ) : <fieldset className="field"><legend>Medical alerts</legend>
          <div className="chips">
            {ALERTS.map((a) => {
              const on = alerts.includes(a);
              return <button key={a} type="button" aria-pressed={on} className={"chip" + (on ? " on" : "")} onClick={() => setAlerts(on ? alerts.filter((x) => x !== a) : [...alerts, a])}>{a}</button>;
            })}
          </div>
          <input className="input" aria-label="Other alerts" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other alerts, separated by commas (e.g. on metformin)" />
        </fieldset>}
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Patient agrees to records and WhatsApp messages</label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : patient ? "Save changes" : "Save patient"}</button>
        </div>
      </form>
    </div>
  );
}
