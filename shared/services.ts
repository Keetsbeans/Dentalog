/** Price list in paise. Editable in Settings later; these are the clinic's usual fees. */
export const SERVICES: { name: string; paise: number; perTooth?: boolean }[] = [
  { name: "Consultation", paise: 50000 },
  { name: "IOPA X-ray", paise: 20000, perTooth: true },
  { name: "Scaling", paise: 150000 },
  { name: "Filling", paise: 80000, perTooth: true },
  { name: "Extraction", paise: 100000, perTooth: true },
  { name: "Root canal", paise: 450000, perTooth: true },
  { name: "Crown", paise: 600000, perTooth: true },
  { name: "Medicines", paise: 0 },
];

export const PAY_MODES = [
  ["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["insurance", "Insurance"], ["emi", "EMI"],
] as const;
export type PayMode = (typeof PAY_MODES)[number][0];

/** Total of the lines, less the discount, never below zero. */
export function billTotal(lines: { amountPaise: number }[], discountPaise = 0) {
  return Math.max(0, lines.reduce((a, l) => a + l.amountPaise, 0) - discountPaise);
}
