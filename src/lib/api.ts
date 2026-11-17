/** Small wrapper around the Dentalog API. Errors carry the server's plain-English message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
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

export type Clinic = { id: string; name: string; doctorName: string; qualification: string | null; phone: string | null; address: string | null };
