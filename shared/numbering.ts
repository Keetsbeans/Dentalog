/** Number formats carried over from the old software. */
export const formatNumber = {
  patient: (n: number) => `CJ${n}`,
  file: (n: number) => `DCJ-${n}`,
  invoice: (n: number) => `INV-${String(n).padStart(4, "0")}`,
  receipt: (n: number) => `RCPT${n}`,
  lab: (n: number) => `L-${n}`,
} as const;

export type Series = keyof typeof formatNumber;
