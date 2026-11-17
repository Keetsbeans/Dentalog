/**
 * Prescription directions are written from the dose so the printout can never
 * say "twice a day" next to 1-1-1 (a mistake seen in the old software).
 */
export type Food = "after" | "before" | "any";

const SLOTS = ["morning", "afternoon", "night"] as const;

export function parseDose(dose: string): number[] | null {
  const m = /^(\d)-(\d)-(\d)$/.exec(dose.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function directions(dose: string, days: number | null, food: Food): string {
  const d = dose.trim().toUpperCase();
  if (d === "SOS") return "Only if needed for pain";
  const parts = parseDose(dose);
  if (!parts) throw new Error(`Unknown dose "${dose}". Use a pattern like 1-0-1, or SOS.`);
  const times = SLOTS.flatMap((slot, i) => {
    const n = parts[i] ?? 0;
    if (n === 0) return [];
    return [n === 1 ? slot : `${n} tablets ${slot}`];
  });
  if (times.length === 0) throw new Error("A dose of 0-0-0 means no tablets at all.");
  const when =
    times.length === 1
      ? times[0]!
      : times.slice(0, -1).join(", ") + " and " + times[times.length - 1];
  const foodText = food === "after" ? ", after food" : food === "before" ? ", before food" : "";
  const daysText = days ? ` for ${days} day${days === 1 ? "" : "s"}` : "";
  return capitalise(when) + foodText + daysText;
}

/** How many tablets to hand over for a course. SOS has no fixed quantity. */
export function quantity(dose: string, days: number | null): number | null {
  const parts = parseDose(dose);
  if (!parts || !days) return null;
  return parts.reduce((a, b) => a + b, 0) * days;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
