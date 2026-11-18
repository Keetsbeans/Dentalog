import { useEffect, useState } from "react";
import { useParams } from "react-router";

type View = {
  clinic: { name: string; phone: string | null; address: string | null };
  firstName: string; when: string; visit: string;
  status: "open" | "confirmed" | "reschedule" | "cancelled" | "past";
  email: string | null; emailConfirmed: boolean;
};

async function call(token: string, body?: object): Promise<View> {
  const r = await fetch(`/api/public/c/${encodeURIComponent(token)}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong. Please call the clinic.");
  return j as View;
}

/** The page a patient opens from their WhatsApp reminder. No sign-in. */
export function Confirm() {
  const { token = "" } = useParams();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [editEmail, setEditEmail] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  useEffect(() => { call(token).then((x) => { setV(x); setEmail(x.email ?? ""); }).catch((e) => setErr((e as Error).message)); }, [token]);
  useEffect(() => { if (v?.clinic.name) document.title = v.clinic.name; }, [v?.clinic.name]);

  async function act(body: object, isEmail = false) {
    setBusy(true); setEmailErr("");
    try { const x = await call(token, body); setV(x); setEditEmail(false); }
    catch (e) { (isEmail ? setEmailErr : setErr)((e as Error).message); }
    finally { setBusy(false); }
  }

  const phone = v?.clinic.phone ?? null;
  return (
    <main className="login">
      <div className="login-card confirm-card">
        {err ? <p className="error" role="alert">{err}</p> : !v ? <p className="muted">Loading…</p> : (
          <>
            <div>
              <p className="eyebrow">{v.clinic.name}</p>
              <h1>Hello {v.firstName}</h1>
            </div>
            <div className="confirm-when">
              <span className="muted">Your {v.visit.toLowerCase()} appointment</span>
              <b>{v.when}</b>
            </div>
            {v.status === "open" && (
              <div className="confirm-actions">
                <button type="button" className="btn primary" disabled={busy} onClick={() => act({ action: "confirm" })}>Yes, I’ll be there</button>
                <button type="button" className="btn" disabled={busy} onClick={() => act({ action: "reschedule" })}>I need another time</button>
              </div>
            )}
            {v.status === "confirmed" && (
              <>
                <p className="confirm-done" role="status">✓ Thank you, your appointment is confirmed.</p>
                <button type="button" className="link-btn" disabled={busy} onClick={() => act({ action: "reschedule" })}>Can’t make it? Ask for another time</button>
              </>
            )}
            {v.status === "reschedule" && (
              <>
                <p className="confirm-note" role="status">We’ve let the clinic know you need another time. They will call or message you to fix one.</p>
                <button type="button" className="link-btn" disabled={busy} onClick={() => act({ action: "confirm" })}>Changed your mind? Keep this time</button>
              </>
            )}
            {v.status === "cancelled" && <p className="confirm-note">This appointment was cancelled. Please call the clinic to book again.</p>}
            {v.status === "past" && <p className="muted">This appointment has passed.</p>}

            <div className="confirm-email">
              {v.email && v.emailConfirmed && !editEmail ? (
                <p className="muted">Email for receipts: <b>{v.email}</b> ✓ <button type="button" className="link-btn" onClick={() => setEditEmail(true)}>Change</button></p>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); act({ email }, true); }}>
                  <label className="field">{v.email ? "Is this your email for receipts?" : "Email for receipts (optional)"}
                    <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
                  </label>
                  {emailErr && <p className="error" role="alert">{emailErr}</p>}
                  <button type="submit" className="btn" disabled={busy || !email.trim()}>{v.email && email.trim().toLowerCase() === v.email ? "Yes, that’s right" : "Save email"}</button>
                </form>
              )}
            </div>

            <p className="muted">{phone && <>Questions? Call <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>.<br /></>}{v.clinic.address}</p>
          </>
        )}
      </div>
    </main>
  );
}
