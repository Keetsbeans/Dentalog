import { DRUG_SETS, DRUGS, type Drug } from "./drugs";
import { SERVICES } from "./services";

export type Service = { name: string; paise: number; perTooth?: boolean };
export type VisitType = { name: string; minutes: number };
export type Lab = { name: string; phone?: string; days: number; work?: string };

/** What the doctor can change in Settings. Anything not saved yet uses the defaults below. */
export type ClinicSettings = {
  services: Service[];
  drugs: Drug[];
  sets: Record<string, string[]>;
  visitTypes: VisitType[];
  labs: Lab[];
  /** Lab work the order form offers. */
  labWork: string[];
};

export const DEFAULT_SETTINGS: ClinicSettings = {
  services: SERVICES,
  drugs: DRUGS,
  sets: DRUG_SETS,
  visitTypes: [
    { name: "Consultation", minutes: 15 }, { name: "Scaling", minutes: 30 }, { name: "Filling", minutes: 30 },
    { name: "Root canal", minutes: 60 }, { name: "Extraction", minutes: 30 }, { name: "Crown / bridge", minutes: 45 },
    { name: "Braces review", minutes: 15 }, { name: "Review", minutes: 15 }, { name: "Emergency", minutes: 30 },
  ],
  labs: [{ name: "Lab A", days: 7 }, { name: "Lab B", days: 10 }],
  labWork: ["PFM crown", "Zirconia crown", "Bridge", "Complete denture", "Partial denture", "Night guard", "Retainer"],
};

/** Saved settings over the defaults, one key at a time. Bad or missing data falls back safely. */
export function readSettings(json: string | null | undefined): ClinicSettings {
  let saved: Partial<ClinicSettings> = {};
  try { saved = JSON.parse(json || "{}") as Partial<ClinicSettings>; } catch { /* use defaults */ }
  return {
    services: Array.isArray(saved.services) ? saved.services : DEFAULT_SETTINGS.services,
    drugs: Array.isArray(saved.drugs) ? saved.drugs : DEFAULT_SETTINGS.drugs,
    sets: saved.sets && typeof saved.sets === "object" ? saved.sets : DEFAULT_SETTINGS.sets,
    visitTypes: Array.isArray(saved.visitTypes) && saved.visitTypes.length ? saved.visitTypes : DEFAULT_SETTINGS.visitTypes,
    labs: Array.isArray(saved.labs) ? saved.labs : DEFAULT_SETTINGS.labs,
    labWork: Array.isArray(saved.labWork) && saved.labWork.length ? saved.labWork : DEFAULT_SETTINGS.labWork,
  };
}
