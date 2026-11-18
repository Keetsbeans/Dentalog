/**
 * India time helpers. The database keeps UTC; the clinic thinks in IST (UTC+5:30, no daylight saving).
 * A "day" is a string like "2026-11-17" and a "time" is "15:30", both in India time.
 */
const IST_MS = 330 * 60 * 1000;
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type Hours = Partial<Record<DayKey, [string, string] | null>>;

/** "2026-11-17", "15:30" (India) → "2026-11-17T10:00:00.000Z" */
export function istToUtc(day: string, time: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_MS).toISOString();
}

/** UTC ISO → India day and time. */
export function utcToIst(iso: string): { day: string; time: string } {
  const t = new Date(new Date(iso).getTime() + IST_MS).toISOString();
  return { day: t.slice(0, 10), time: t.slice(11, 16) };
}

export function todayIst(now = new Date()): string {
  return utcToIst(now.toISOString()).day;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekday(day: string): DayKey {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Monday of the week the day falls in. */
export function weekStart(day: string): string {
  const i = DAY_KEYS.indexOf(weekday(day));
  return addDays(day, i === 0 ? -6 : 1 - i);
}

export const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
export const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** "15:30" → "3:30 PM" */
export function label12(time: string): string {
  const n = toMinutes(time);
  const h = Math.floor(n / 60), m = n % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Opening hours on one date: null when it's a closed weekday or a holiday. */
export function hoursOn(hours: Hours, day: string, holidays: { day: string }[] = []): [string, string] | null {
  if (holidays.some((h) => h.day === day)) return null;
  return hours[weekday(day)] ?? null;
}

/** Bookable slot start times for a day, every `step` minutes, or [] when closed. */
export function slots(hours: Hours, day: string, step = 30, holidays: { day: string }[] = []): string[] {
  const h = hoursOn(hours, day, holidays);
  if (!h) return [];
  const out: string[] = [];
  for (let t = toMinutes(h[0]); t + step <= toMinutes(h[1]); t += step) out.push(fromMinutes(t));
  return out;
}

/** True when two bookings share any minute. */
export function overlaps(aStart: string, aMin: number, bStart: string, bMin: number): boolean {
  const a = new Date(aStart).getTime(), b = new Date(bStart).getTime();
  return a < b + bMin * 60_000 && b < a + aMin * 60_000;
}
