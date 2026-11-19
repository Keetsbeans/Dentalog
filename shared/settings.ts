import { DRUG_SETS, DRUGS, type Drug } from "./drugs";
import { SERVICES } from "./services";
import { DEFAULT_TEMPLATES, type Templates } from "./messages";
import { DEFAULT_PRINT, readPrint, RECEIPT_FOOTER, type PrintLayout } from "./print";

export type Service = { name: string; paise: number; perTooth?: boolean; group?: string };
export type Holiday = { day: string; name: string };
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
  /** WhatsApp message wording, one per kind of message. */
  templates: Templates;
  /** Same-day reminder: how many minutes before the appointment it is due. */
  soonMinutes: number;
  /** Google review link for the "Ask for a review" message. */
  reviewLink: string;
  /** Days the clinic is closed beyond the weekly hours. */
  holidays: Holiday[];
  /** Prescription layout. */
  print: PrintLayout;
  /** Receipt layout. */
  printReceipt: PrintLayout;
  /** Whether the receptionist can see bills, take payments and print receipts. Never totals or reports. */
  receptionBilling: boolean;
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
  templates: DEFAULT_TEMPLATES,
  soonMinutes: 60,
  reviewLink: "",
  holidays: [],
  print: DEFAULT_PRINT,
  printReceipt: { ...DEFAULT_PRINT, footer: RECEIPT_FOOTER },
  receptionBilling: false,
};

/** The first wording, signed by the doctor. Saved copies of it move to the new automated wording. */
const FIRST_WORDING: Record<string, string> = {
  reminder: "Hello {name}, this is a reminder of your {visit} appointment at {clinic} on {day} at {time}. Please reply here if you need to change the time. – {doctor}",
  recall: "Hello {name}, your last visit to {clinic} was in {last}. A check-up and cleaning every 6 months keeps teeth and gums healthy. Reply here and we’ll book a time that suits you. – {doctor}",
  balance: "Hello {name}, a balance of {amount} is pending for your treatment at {clinic}. You can pay at your next visit, or by UPI to {upi}. Thank you! – {doctor}",
  lab_ready: "Hello {name}, your {work} is back from the lab and ready at {clinic}. Please reply here to book a time to have it fitted. – {doctor}",
};
function unchangedOld(t: unknown): Partial<Record<string, string>> {
  if (!t || typeof t !== "object") return {};
  return Object.fromEntries(Object.entries(t as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1].trim() && e[1] !== FIRST_WORDING[e[0]]));
}

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
    soonMinutes: [30, 60, 90, 120].includes(Number(saved.soonMinutes)) ? Number(saved.soonMinutes) : DEFAULT_SETTINGS.soonMinutes,
    reviewLink: typeof saved.reviewLink === "string" ? saved.reviewLink : "",
    templates: { ...DEFAULT_TEMPLATES, ...unchangedOld(saved.templates) },
    holidays: Array.isArray(saved.holidays) ? saved.holidays.filter((h) => h && /^\d{4}-\d{2}-\d{2}$/.test(h.day)).map((h) => ({ day: h.day, name: String(h.name ?? "") })) : [],
    print: readPrint(saved.print),
    // Before receipts had their own layout they used the prescription's; start from that.
    printReceipt: saved.printReceipt ? readPrint(saved.printReceipt) : { ...readPrint(saved.print), footer: RECEIPT_FOOTER },
    receptionBilling: saved.receptionBilling === true,
  };
}
