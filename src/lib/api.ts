/** Small wrapper around the Dentalog API. Errors carry the server's plain-English message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; clash?: boolean };
  // A lapsed session anywhere sends the app back to the sign-in screen.
  if (res.status === 401 && !["/login", "/setup", "/reset-owner", "/me/password"].includes(path)) window.dispatchEvent(new Event("dentalog:signed-out"));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, !!body.clash);
  return body;
}

export type Patient = {
  id: string; code: string; fileNo: string | null; name: string; phone: string; phoneCc: string;
  email: string | null; emailConfirmedAt: string | null; notes?: string | null; whatsappConsent?: boolean;
  gender: "F" | "M" | "O" | null; birthYear: number | null; alerts: string[]; createdAt: string;
};

export type TrashItem = {
  kind: "patient" | "appointment" | "visit" | "invoice" | "receipt" | "lab" | "file";
  id: string; title: string; detail: string; deletedAt: string; reason: string | null; daysLeft: number;
};

export type Clinic = { id: string; name: string; doctorName: string; qualification: string | null; phone: string | null; address: string | null; hoursJson: string; upiId: string | null;
  email: string | null; website: string | null; settings: import("../../shared/settings").ClinicSettings;
  /** When each uploaded picture last changed. Missing means the built-in one is used. */
  images?: Partial<Record<"logo" | "letterhead" | "signature", string>> };

const BUILT_IN = { logo: "/clinic-logo.png", letterhead: "/letterhead.jpg", signature: null } as const;
/** Where to load the clinic's logo, letterhead or signature from. */
export function imageUrl(clinic: Clinic | null | undefined, key: "logo" | "letterhead" | "signature"): string | null {
  const v = clinic?.images?.[key];
  return v ? `/api/clinic/images/${key}?v=${encodeURIComponent(v)}` : BUILT_IN[key];
}

export type ApptStatus = "booked" | "arrived" | "in_chair" | "done" | "no_show" | "cancelled";
export type Appointment = {
  id: string; startsAt: string; minutes: number; visitType: string; status: ApptStatus;
  squeezedIn: boolean; notes: string | null; confirmedAt: string | null; rescheduleAt: string | null;
  patient: { id: string; name: string; code: string; phone: string; phoneCc: string; alerts: string[] };
};

/** Errors that come with a flag, e.g. a 409 double booking. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public clash = false) { super(message); }
}

export type Food = "after" | "before" | "any";
export type RxItem = { id?: string; drug: string; generic: string | null; dose: string; days: number | null; food: Food; instruction?: string; quantity?: number | null };
export type Visit = {
  id: string; patientId: string; appointmentId: string | null; createdAt: string; signedAt: string | null;
  vitals: Record<string, string>; tooth: string | null; complaint: string | null; findings: string[]; diagnosis: string[];
  notes: string | null; advice: string[]; adviceNote: string | null; nextVisit: string | null;
};
export type Addendum = { id: string; text: string; createdAt: string };
export type VisitBundle = { visit: Visit; patient: Patient & { notes: string | null }; items: RxItem[]; addenda: Addendum[];
  /** Another doctor who signed (or started) the note; null means the clinic's own doctor. */
  doctor?: { name: string; qualification: string | null } | null };

/** Opens (or reopens) the visit note for a patient and returns its id. */
export async function startVisit(patientId: string, appointmentId?: string) {
  const r = await api<{ id: string }>("/visits", { method: "POST", body: JSON.stringify({ patientId, appointmentId }) });
  return r.id;
}

export type PayMode = "cash" | "upi" | "card" | "insurance" | "emi";
export type InvoiceSummary = {
  id: string; number: string; issuedAt: string; totalPaise: number; discountPaise: number; paidPaise: number; balancePaise: number;
  patient: { id: string; name: string; code: string; phone: string };
};
export type Receipt = { id: string; number: string; amountPaise: number; mode: PayMode; reference: string | null; receivedAt: string; invoiceId: string | null };
export type BillVersion = { lines: { service: string; tooth: string | null; amountPaise: number }[]; discountPaise: number; totalPaise: number };
export type Invoice = InvoiceSummary & {
  lines: { id: string; service: string; tooth: string | null; amountPaise: number }[]; receipts: Receipt[];
  edits: { id: string; reason: string; createdAt: string; before: BillVersion; after: BillVersion }[];
};

export type LabOrder = {
  id: string; number: string; lab: string; work: string; tooth: string | null; shade: string | null;
  sentOn: string; dueOn: string; status: "sent" | "received" | "fitted"; billPaise: number; paidPaise: number; createdAt: string;
  patient: { id: string; name: string; code: string };
};
