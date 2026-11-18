import { useEffect, useRef, useState } from "react";
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

export function Account() {
  const { clinic } = useClinic();
  const initials = (clinic?.doctorName ?? "").replace(/^Dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="visit-grid">
      <section className="card stack">
        <h2>Your account</h2>
        <div className="account-row">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span><b>{clinic?.doctorName}</b><span className="muted">Owner · signs in with the clinic password</span></span>
        </div>
        <p className="muted">The password isn’t stored in Dentalog’s code. It’s kept as a secret in Cloudflare (Workers → dentalog → Settings → Variables and secrets → <code>DENTALOG_PASSWORD</code>). Changing it there signs everyone out.</p>
        <p className="muted">Sign-ins are recorded in the activity log under Your data.</p>
      </section>
      <section className="card stack">
        <h2>Staff logins</h2>
        <p className="muted">For an assistant or receptionist, with limited access (no reports or settings). Not set up yet. Ask Claude when you’re ready to add one.</p>
        <button type="button" className="btn" disabled>Add staff (coming later)</button>
      </section>
    </div>
  );
}

/* ---------- Your data ---------- */

type Log = { id: number; at: string; actor: string; action: string; entity: string; entityId: string; detail: string | null };
const VERB: Record<string, string> = { create: "Added", update: "Changed", sign: "Signed", delete: "Deleted", restore: "Restored", purge: "Removed for good", upload: "Uploaded", remove: "Removed" };
const NOUN: Record<string, string> = { patient: "a patient", appointment: "an appointment", visit: "a visit note", addendum: "an addendum", invoice: "a bill", receipt: "a payment", lab: "a lab order", clinic: "clinic settings", file: "a file" };
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
