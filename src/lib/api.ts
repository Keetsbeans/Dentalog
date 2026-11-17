/** Small wrapper around the Dentalog API. Errors carry the server's plain-English message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; clash?: boolean };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, !!body.clash);
  return body;
}

export type Patient = {
  id: string; code: string; fileNo: string | null; name: string; phone: string;
  gender: "F" | "M" | "O" | null; birthYear: number | null; alerts: string[]; createdAt: string;
};

export type TrashItem = {
  kind: "patient" | "appointment" | "visit" | "invoice" | "receipt" | "lab" | "file";
  id: string; title: string; detail: string; deletedAt: string; reason: string | null; daysLeft: number;
};

export type Clinic = { id: string; name: string; doctorName: string; qualification: string | null; phone: string | null; address: string | null; hoursJson: string };

export type ApptStatus = "booked" | "arrived" | "in_chair" | "done" | "no_show" | "cancelled";
export type Appointment = {
  id: string; startsAt: string; minutes: number; visitType: string; status: ApptStatus;
  squeezedIn: boolean; notes: string | null;
  patient: { id: string; name: string; code: string; phone: string; alerts: string[] };
};

/** Errors that come with a flag, e.g. a 409 double booking. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public clash = false) { super(message); }
}
