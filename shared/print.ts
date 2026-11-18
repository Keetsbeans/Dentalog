/** How prescriptions and receipts are laid out. Set once in Settings → Printouts. */
export type PrintLayout = {
  /** letterhead: the uploaded heading picture. blank: leave space for a pre-printed pad. simple: logo and clinic details in text. */
  header: "letterhead" | "blank" | "simple";
  /** Space kept free at the top (blank pads) and bottom, in mm. */
  topMm: number;
  bottomMm: number;
  show: { alerts: boolean; diagnosis: boolean; advice: boolean; next: boolean; phone: boolean; upi: boolean };
  accent: "teal" | "black";
  /** line: a blank line to sign on. image: the uploaded signature. */
  signature: "line" | "image";
  footer: string;
  paper: "A4" | "A5";
};

export const DEFAULT_PRINT: PrintLayout = {
  header: "letterhead", topMm: 45, bottomMm: 15,
  show: { alerts: true, diagnosis: true, advice: true, next: true, phone: true, upi: true },
  accent: "teal", signature: "line", footer: "Not valid without signature", paper: "A4",
};

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

/** Saved layout over the defaults; anything odd falls back. */
export function readPrint(v: unknown): PrintLayout {
  const p = (v && typeof v === "object" ? v : {}) as Partial<PrintLayout>;
  const show = (p.show && typeof p.show === "object" ? p.show : {}) as Partial<PrintLayout["show"]>;
  return {
    header: p.header === "blank" || p.header === "simple" ? p.header : "letterhead",
    topMm: clamp(p.topMm, 0, 120, DEFAULT_PRINT.topMm),
    bottomMm: clamp(p.bottomMm, 0, 60, DEFAULT_PRINT.bottomMm),
    show: Object.fromEntries(Object.entries(DEFAULT_PRINT.show).map(([k, d]) => [k, typeof show[k as keyof typeof show] === "boolean" ? show[k as keyof typeof show] : d])) as PrintLayout["show"],
    accent: p.accent === "black" ? "black" : "teal",
    signature: p.signature === "image" ? "image" : "line",
    footer: typeof p.footer === "string" ? p.footer.slice(0, 120) : DEFAULT_PRINT.footer,
    paper: p.paper === "A5" ? "A5" : "A4",
  };
}
