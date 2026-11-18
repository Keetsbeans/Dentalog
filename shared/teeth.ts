/** Tooth chart: FDI numbering (11–48 adult, 51–85 baby teeth). */

export const ADULT_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const ADULT_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const CHILD_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const CHILD_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
const ALL = new Set([...ADULT_UPPER, ...ADULT_LOWER, ...CHILD_UPPER, ...CHILD_LOWER]);
export const isTooth = (n: number) => ALL.has(n);

export const CONDITIONS = ["Healthy", "Caries", "Pulpitis", "Fracture", "Missing", "RCT done", "Crown"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const COND_CODE: Record<Condition, string> = { Healthy: "", Caries: "C", Pulpitis: "P", Fracture: "F", Missing: "M", "RCT done": "RCT", Crown: "Cr" };

/** Treatments that can be planned on a tooth, their sittings, and the price-list service they bill as. */
export const PLANS = {
  Filling: { code: "Fill", label: "Filling", service: "Filling", steps: ["Filling"], after: "Healthy" },
  RCT: { code: "RCT", label: "Root canal treatment", service: "Root canal", steps: ["Access opening", "Cleaning & shaping", "Obturation"], after: "RCT done" },
  Crown: { code: "Cr", label: "Crown", service: "Crown", steps: ["Tooth preparation", "Crown fitting"], after: "Crown" },
  Extraction: { code: "Ext", label: "Extraction", service: "Extraction", steps: ["Extraction"], after: "Missing" },
  Implant: { code: "Imp", label: "Implant", service: "Implant", steps: ["Implant placement", "Healing review", "Crown on implant"], after: "Crown" },
} as const satisfies Record<string, { code: string; label: string; service: string; steps: readonly string[]; after: Condition }>;
export type PlanName = keyof typeof PLANS;
export const PLAN_NAMES = Object.keys(PLANS) as PlanName[];

export type ToothState = { tooth: number; condition: Condition; plan: PlanName | null; done: number; billed: boolean };
export const blank = (tooth: number): ToothState => ({ tooth, condition: "Healthy", plan: null, done: 0, billed: false });
export const sittings = (t: ToothState) => (t.plan ? PLANS[t.plan].steps.length : 0);
export const complete = (t: ToothState) => !!t.plan && t.done >= sittings(t);

/** How the tile is coloured. */
export type Look = "healthy" | "problem" | "planned" | "done" | "missing";
export function lookOf(t: ToothState): Look {
  if (t.plan) return complete(t) ? "done" : "planned";
  if (t.condition === "Missing") return "missing";
  if (t.condition === "RCT done" || t.condition === "Crown") return "done";
  if (t.condition === "Healthy") return "healthy";
  return "problem";
}
export const codeOf = (t: ToothState) => (t.plan ? PLANS[t.plan].code : COND_CODE[t.condition]);

const ADULT = ["", "central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
const CHILD = ["", "central incisor", "lateral incisor", "canine", "first molar", "second molar"];
const QUAD: Record<number, string> = { 1: "Upper right", 2: "Upper left", 3: "Lower left", 4: "Lower right", 5: "Upper right", 6: "Upper left", 7: "Lower left", 8: "Lower right" };
export function toothName(n: number) {
  const q = Math.floor(n / 10), p = n % 10;
  return `${QUAD[q]} ${q > 4 ? `baby ${CHILD[p]}` : ADULT[p]}`;
}

/** "16, 36 37" → [16, 36, 37]; anything that isn't a tooth number is ignored. */
export function parseTeeth(text: string | null | undefined): number[] {
  const out: number[] = [];
  for (const m of (text ?? "").matchAll(/\d{2}/g)) {
    const n = Number(m[0]);
    if (isTooth(n) && !out.includes(n)) out.push(n);
  }
  return out;
}
