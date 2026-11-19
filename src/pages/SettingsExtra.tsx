import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, imageUrl, type Clinic } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useToast } from "../components/Toast";
import { RxSheet, ReceiptSheet } from "../components/PrintSheet";
import { SAMPLE_RECEIPT, SAMPLE_RX } from "../components/PrintSamples";
import { dayLabel } from "../components/Appointments";
import { preparePicture, type PictureKind } from "../lib/pictures";
import { table, workbook } from "../lib/xlsx";
import { todayIst, utcToIst, label12 } from "../../shared/time";
import type { Holiday } from "../../shared/settings";
import type { PrintLayout } from "../../shared/print";
import { ROLE_LABEL, type Role } from "../../shared/roles";
import { useMe } from "../components/AuthGate";

/* ---------- Pictures: logo, letterhead, signature ---------- */

const PIC_LABEL: Record<PictureKind, string> = { logo: "Logo", letterhead: "Letterhead", signature: "Signature" };

/** Uploads straight away (no Save needed), since a picture is either there or not. */
export function PictureField({ kind, hint }: { kind: PictureKind; hint: string }) {
  const { clinic, reload } = useClinic();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const custom = !!clinic?.images?.[kind];
  const src = imageUrl(clinic, kind);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const blob = await preparePicture(file, kind);
      const res = await fetch(`/api/clinic/images/${kind}`, { method: "PUT", headers: { "content-type": blob.type }, body: blob });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed.");
      await reload();
      toast({ title: `${PIC_LABEL[kind]} updated` });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    setBusy(true);
    try { await api(`/clinic/images/${kind}`, { method: "DELETE" }); await reload(); toast({ title: kind === "signature" ? "Signature removed" : `Back to the original ${kind}` }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className={`pic-field pic-${kind}`}>
      <div className="pic-thumb">{src ? <img src={src} alt={`Current ${kind}`} /> : <span className="muted">None yet</span>}</div>
      <div className="pic-info">
        <b>{PIC_LABEL[kind]}</b>
        <span className="muted">{hint}</span>
        <div className="pic-actions">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" id={`pic-${kind}`} onChange={(e) => pick(e.target.files?.[0])} />
          <label htmlFor={`pic-${kind}`} className={"btn" + (busy ? " disabled" : "")} aria-disabled={busy}>{busy ? "Uploading…" : src ? `Replace ${kind}` : `Upload ${kind}`}</label>
          {custom && <button type="button" className="link-btn" disabled={busy} onClick={remove}>{kind === "signature" ? "Remove" : "Use the original"}</button>}
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </div>
  );
}

/* ---------- A scaled-down live page ---------- */

export function SheetPreview({ clinic, layout, doc }: { clinic: Clinic | null; layout: PrintLayout; doc: "rx" | "receipt" }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const pageMm = layout.paper === "A5" ? 148 : 210;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setScale(el.clientWidth / (pageMm * 3.7795));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [pageMm]);
  const hMm = layout.paper === "A5" ? 210 : 297;
  return (
    <div ref={box} className="sheet-preview" style={{ height: hMm * 3.7795 * scale }} aria-label={`Preview of a ${doc === "rx" ? "prescription" : "receipt"}`}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${pageMm}mm` }} inert>
        {doc === "rx" ? <RxSheet data={SAMPLE_RX} clinic={clinic} layout={layout} /> : <ReceiptSheet data={SAMPLE_RECEIPT} clinic={clinic} layout={layout} />}
      </div>
    </div>
  );
}

/* ---------- Holidays ---------- */

export function Holidays({ list, onChange }: { list: Holiday[]; onChange: (l: Holiday[]) => void }) {
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const today = todayIst();
  const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = sorted.filter((h) => h.day >= today), past = sorted.length - upcoming.length;
  return (
    <section className="card stack">
      <h2>Holidays</h2>
      <p className="muted">Days the clinic is shut. They show as closed in the calendar, and nobody can be booked on them.</p>
      {upcoming.length === 0 ? <p className="muted">No holidays coming up.</p> : (
        <ul className="list holidays">
          {upcoming.map((h) => (
            <li key={h.day}>
              <span><b>{dayLabel(h.day, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</b>{h.name ? ` · ${h.name}` : ""}</span>
              <button type="button" className="link-btn" onClick={() => onChange(list.filter((x) => x.day !== h.day))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {past > 0 && <p className="muted">{past} past {past === 1 ? "holiday" : "holidays"} kept for the record.</p>}
      <div className="holiday-add">
        <label className="field">Date<input type="date" className="input" min={today} value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="field grow">Name (optional)<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pongal" /></label>
        <button type="button" className="btn" disabled={!day} onClick={() => { onChange([...list.filter((x) => x.day !== day), { day, name: name.trim() }]); setDay(""); setName(""); }}>+ Add holiday</button>
      </div>
    </section>
  );
}

/* ---------- Printouts ---------- */

const SHOW_LABEL: Record<keyof PrintLayout["show"], string> = {
  alerts: "Medical alerts", diagnosis: "Diagnosis", advice: "Advice", next: "Next visit", phone: "Patient’s mobile number", upi: "UPI ID on receipts",
};

export function Printouts({ layout, onChange }: { layout: PrintLayout; onChange: (p: PrintLayout) => void }) {
  const { clinic } = useClinic();
  const [doc, setDoc] = useState<"rx" | "receipt">("rx");
  const set = (patch: Partial<PrintLayout>) => onChange({ ...layout, ...patch });
  return (
    <div className="print-setup">
      <div className="stack">
        <section className="card stack">
          <h2>1. Letterhead</h2>
          <div className="radio-cards">
            {([["letterhead", "Printed from Dentalog", "Your letterhead picture goes at the top of every page"], ["blank", "Pre-printed pad", "Leave the top empty for your printed header"], ["simple", "Simple heading", "Logo, clinic name and address in plain text"]] as const).map(([v, l, sub]) => (
              <label key={v} className={"radio-card" + (layout.header === v ? " on" : "")}>
                <input type="radio" name="header" checked={layout.header === v} onChange={() => set({ header: v })} />
                <b>{l}</b><span className="muted">{sub}</span>
              </label>
            ))}
          </div>
          {layout.header === "letterhead" && <PictureField kind="letterhead" hint="A PDF or picture of your heading. Dentalog keeps the top part of the page, where the heading is." />}
          {layout.header === "simple" && <PictureField kind="logo" hint="Shown in the menu and on the simple heading." />}
          {layout.header === "blank" && (
            <label className="field">Space to leave at the top: <b>{layout.topMm} mm</b>
              <input type="range" min={10} max={100} value={layout.topMm} onChange={(e) => set({ topMm: Number(e.target.value) })} />
            </label>
          )}
          <label className="field">Space to leave at the bottom: <b>{layout.bottomMm} mm</b>
            <input type="range" min={0} max={50} value={layout.bottomMm} onChange={(e) => set({ bottomMm: Number(e.target.value) })} />
          </label>
          <p className="muted">Print one test page on your pad, then nudge these until the text sits clear of anything printed.</p>
        </section>
        <section className="card stack">
          <h2>2. What to show</h2>
          <div className="check-grid">
            {(Object.keys(SHOW_LABEL) as (keyof PrintLayout["show"])[]).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={layout.show[k]} onChange={(e) => set({ show: { ...layout.show, [k]: e.target.checked } })} /> {SHOW_LABEL[k]}</label>
            ))}
          </div>
        </section>
        <section className="card stack">
          <h2>3. Look and paper</h2>
          <div className="row2">
            <div className="field"><span>Colour</span>
              <div className="seg small" role="group" aria-label="Colour">
                <button type="button" aria-pressed={layout.accent === "teal"} onClick={() => set({ accent: "teal" })}>Teal</button>
                <button type="button" aria-pressed={layout.accent === "black"} onClick={() => set({ accent: "black" })}>Black only</button>
              </div>
            </div>
            <div className="field"><span>Paper</span>
              <div className="seg small" role="group" aria-label="Paper">
                <button type="button" aria-pressed={layout.paper === "A4"} onClick={() => set({ paper: "A4" })}>A4</button>
                <button type="button" aria-pressed={layout.paper === "A5"} onClick={() => set({ paper: "A5" })}>A5</button>
              </div>
            </div>
          </div>
        </section>
        <section className="card stack">
          <h2>4. Signature and footer</h2>
          <div className="seg small" role="group" aria-label="Signature">
            <button type="button" aria-pressed={layout.signature === "line"} onClick={() => set({ signature: "line" })}>Sign by hand</button>
            <button type="button" aria-pressed={layout.signature === "image"} onClick={() => set({ signature: "image" })}>Print my signature</button>
          </div>
          {layout.signature === "image" && <PictureField kind="signature" hint="Sign on white paper and take a photo, or upload a scan. Use a clear, dark pen." />}
          <label className="field">Footer line on prescriptions<input className="input" maxLength={120} value={layout.footer} onChange={(e) => set({ footer: e.target.value })} /></label>
        </section>
      </div>
      <section className="card stack print-live">
        <div className="card-head">
          <h2>Live preview</h2>
          <div className="seg small" role="group" aria-label="Which printout">
            <button type="button" aria-pressed={doc === "rx"} onClick={() => setDoc("rx")}>Prescription</button>
            <button type="button" aria-pressed={doc === "receipt"} onClick={() => setDoc("receipt")}>Receipt</button>
          </div>
        </div>
        <SheetPreview clinic={clinic} layout={layout} doc={doc} />
        <p className="muted">The test page uses the saved layout, so save your changes first.</p>
        <a className="btn" href="/print/rx/test" target="_blank" rel="noopener noreferrer">Print a test page</a>
      </section>
    </div>
  );
}

/* ---------- Messages channels ---------- */

export function Channels() {
  const { settings } = useClinic();
  const soon = settings.soonMinutes < 60 ? `${settings.soonMinutes} minutes` : `${settings.soonMinutes / 60} hour${settings.soonMinutes > 60 ? "s" : ""}`;
  return (
    <section className="card stack">
      <h2>Channels</h2>
      <ul className="list channels">
        <li><span><b>WhatsApp, one tap</b><span className="muted">Each message opens in WhatsApp on your phone or computer with the words typed in. You tap Send.</span></span><span className="pill s-ok">On</span></li>
        <li><span><b>WhatsApp, fully automatic</b><span className="muted">Needs a WhatsApp Business API account. Messages then go out by themselves, with delivered and read ticks.</span></span><span className="pill s-done">Not set up</span></li>
        <li><span><b>SMS</b><span className="muted">Needs a DLT-registered sender ID in India first.</span></span><span className="pill s-done">Not set up</span></li>
      </ul>
      <h2>Reminders</h2>
      <ul className="list channels">
        <li><span><b>Day-before reminder</b><span className="muted">With a link to confirm or ask for another time</span></span></li>
        <li><span><b>Same-day reminder</b><span className="muted">{soon} before the appointment, flagged on the home page when it’s due</span></span></li>
      </ul>
      <p><Link to="/messages?tab=wording">Change the wording and timing in Messages → Templates</Link></p>
    </section>
  );
}

/* ---------- Account ---------- */

type Staff = { id: string; name: string; email: string; role: Role; qualification: string | null; active: boolean; lastLoginAt: string | null; createdAt: string };
const ROLE_NOTE: Record<Role, string> = {
  owner: "Everything, including money totals, messages, settings and deleting.",
  doctor: "All patients, visit notes, prescriptions in their own name, tooth chart, files, lab orders and bills. Asks you to send WhatsApp messages. No reports, settings or deleting.",
  reception: "Patients, calendar, X-rays and files, lab orders received. Can read visit notes but not write them. Asks you to send WhatsApp messages. No money totals.",
};

export function Account({ receptionBilling, onReceptionBilling }: { receptionBilling: boolean; onReceptionBilling: (on: boolean) => void }) {
  const me = useMe();
  const toast = useToast();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [form, setForm] = useState<Staff | "new" | null>(null);
  const load = () => api<Staff[]>("/staff").then(setStaff).catch(() => setStaff([]));
  useEffect(() => { load(); }, []);
  const initials = (n: string) => n.replace(/^Dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const seen = (u: Staff) => u.lastLoginAt ? `last signed in on ${dayLabel(utcToIst(u.lastLoginAt).day, { day: "numeric", month: "short" })}` : "hasn’t signed in yet";

  return (
    <div className="visit-grid">
      <section className="card stack">
        <div className="card-head"><h2>People who can sign in</h2><button type="button" className="btn primary" onClick={() => setForm("new")}>Add a login</button></div>
        {!staff ? <p className="muted">Loading…</p> : (
          <ul className="list">
            {staff.map((u) => (
              <li key={u.id} className={"list-row staff-row" + (u.active ? "" : " off")}>
                <span className="account-row">
                  <span className="avatar" aria-hidden="true">{initials(u.name)}</span>
                  <span><b>{u.name}{u.qualification ? `, ${u.qualification}` : ""}</b>
                    <span className="muted">{ROLE_LABEL[u.role]} · {u.email}{u.id === me.user.id ? " · you" : ""}</span>
                    <span className="muted small">{u.active ? seen(u) : "Switched off"}</span></span>
                </span>
                {u.role !== "owner" && <button type="button" className="btn small" onClick={() => setForm(u)}>Edit</button>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">Each person signs in with their own email and password, so the activity log shows who did what. To change your own password, open your name at the bottom of the menu.</p>
      </section>
      <div className="stack">
        <section className="card stack">
          <h2>What each role can do</h2>
          {(["owner", "doctor", "reception"] as Role[]).map((r) => <p key={r}><b>{ROLE_LABEL[r]}</b><br /><span className="muted">{ROLE_NOTE[r]}</span></p>)}
          <label className="check"><input type="checkbox" checked={receptionBilling} onChange={(e) => onReceptionBilling(e.target.checked)} /> Receptionist can see bills and take payments</label>
          <p className="muted small">Even with this on, the receptionist never sees the day’s collection, reports or totals, and can’t give discounts or edit bills. Save changes at the top after ticking it.</p>
        </section>
        <section className="card stack">
          <h2>If you forget your password</h2>
          <p className="muted">On the sign-in screen, tap “Forgot your password?” and enter the clinic password. That password lives only in Cloudflare (Workers → dentalog → Settings → Variables and secrets → <code>DENTALOG_PASSWORD</code>). Changing it there signs everyone out.</p>
        </section>
      </div>
      {form && <StaffForm user={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={(msg) => { setForm(null); toast({ title: msg }); load(); }} />}
    </div>
  );
}

function StaffForm({ user, onClose, onSaved }: { user: Staff | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", role: (user?.role ?? "doctor") as Role, qualification: user?.qualification ?? "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function call(body: object, msg: string) {
    setBusy(true); setErr("");
    try {
      if (user) await api(`/staff/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/staff", { method: "POST", body: JSON.stringify(body) });
      onSaved(msg);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function save(e: FormEvent) {
    e.preventDefault();
    if (!user) return call(f, `${f.name.trim()} can sign in now. Give them their email and temporary password.`);
    const body: Record<string, unknown> = { name: f.name, role: f.role, qualification: f.qualification };
    if (f.password) body.password = f.password;
    call(body, f.password ? `${f.name.trim()}’s details and password saved. They’re signed out until they use the new password.` : `${f.name.trim()}’s details saved.`);
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog open" onSubmit={save} aria-labelledby="sf-title">
        <h2 id="sf-title">{user ? `Edit ${user.name}` : "Add a login"}</h2>
        <label className="field">Name<input className="input" autoFocus={!user} value={f.name} onChange={set("name")} placeholder="Dr Priya Raman" /></label>
        <label className="field">Email they’ll sign in with<input className="input" type="email" disabled={!!user} value={f.email} onChange={set("email")} /></label>
        <fieldset className="field"><legend>Role</legend>
          <div className="seg" role="group">
            <button type="button" aria-pressed={f.role === "doctor"} onClick={() => setF({ ...f, role: "doctor" })}>Doctor</button>
            <button type="button" aria-pressed={f.role === "reception"} onClick={() => setF({ ...f, role: "reception" })}>Receptionist</button>
          </div>
          <span className="muted small">{ROLE_NOTE[f.role]}</span>
        </fieldset>
        {f.role === "doctor" && <label className="field">Qualification (printed on their prescriptions)<input className="input" value={f.qualification} onChange={set("qualification")} placeholder="BDS, MDS" /></label>}
        <label className="field">{user ? "New password (leave blank to keep theirs)" : "Temporary password (8 or more characters)"}
          <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={set("password")} />
          {!user && <span className="muted small">They can change it from their name at the bottom of the menu.</span>}
        </label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dialog-actions">
          {user && <button type="button" className={"btn " + (user.active ? "danger-outline" : "")} disabled={busy} onClick={() => call({ active: !user.active }, user.active ? `${user.name} is switched off and signed out everywhere.` : `${user.name} can sign in again.`)}>{user.active ? "Switch off login" : "Switch login back on"}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : user ? "Save" : "Add login"}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Your data ---------- */

type Log = { id: number; at: string; actor: string; action: string; entity: string; entityId: string; detail: string | null };
const VERB: Record<string, string> = { create: "Added", update: "Changed", sign: "Signed", delete: "Deleted", restore: "Restored", purge: "Removed for good", upload: "Uploaded", remove: "Removed", discard: "Discarded", request: "Asked to send" };
const NOUN: Record<string, string> = { patient: "a patient", appointment: "an appointment", visit: "a visit note", addendum: "an addendum", invoice: "a bill", receipt: "a payment", lab: "a lab order", clinic: "clinic settings", file: "a file", staff: "a staff login", message: "a message request" };
function describe(l: Log) {
  if (l.entity === "login") return l.action === "login" ? "Signed in" : "Wrong password tried";
  if (l.action === "export") return "Exported all data to Excel";
  if (l.entity === "picture") return `${VERB[l.action] ?? l.action} the ${l.entityId}`;
  return `${VERB[l.action] ?? l.action} ${NOUN[l.entity] ?? l.entity}`;
}

export function YourData() {
  const toast = useToast();
  const [log, setLog] = useState<Log[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api<Log[]>("/activity").then(setLog).catch(() => setLog([])); }, []);

  async function exportAll() {
    setBusy(true); setErr("");
    try {
      const data = await api<Record<string, Record<string, unknown>[]>>("/export");
      const bytes = workbook(Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, table(rows)])));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `Dentalog export ${todayIst()}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ title: "Export downloaded" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="visit-grid">
      <div className="stack">
        <section className="card stack">
          <h2>Backups</h2>
          <p className="muted">Cloudflare keeps a restore point of the database for every minute of the last 30 days (7 days on the free plan). If something goes wrong, everything can be put back to how it was at any moment in that time. Export to Excel below for a copy of your own.</p>
        </section>
        <section className="card stack">
          <h2>Recently deleted</h2>
          <p className="muted">Deleted patients, visits, bills and lab orders are kept for 30 days, then removed for good.</p>
          <Link className="btn" to="/recently-deleted">Open Recently deleted</Link>
        </section>
        <section className="card stack">
          <h2>Export and import</h2>
          <p className="muted">Download everything (patients, visits, prescriptions, bills, payments, lab orders, messages) as one Excel file, a sheet for each.</p>
          <button type="button" className="btn primary" disabled={busy} onClick={exportAll}>{busy ? "Preparing…" : "Export all data (Excel)"}</button>
          {err && <p className="error" role="alert">{err}</p>}
          <p className="muted"><b>Import from your old software:</b> export your patient list from it (Excel or CSV) and send it to Claude. Patients come in with their old CJ numbers.</p>
        </section>
      </div>
      <section className="card stack">
        <h2>Activity log</h2>
        <p className="muted">Sign-ins and every add, change, delete and export, newest first.</p>
        {!log ? <p className="muted">Loading…</p> : log.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
          <ul className="list activity">
            {log.slice(0, 60).map((l) => {
              const t = utcToIst(l.at);
              return (
                <li key={l.id}>
                  <span className={l.action === "login_failed" ? "due" : ""}>{describe(l)}</span>
                  <span className="muted nums">{dayLabel(t.day)}, {label12(t.time)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
