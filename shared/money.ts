/** All money is kept in paise (whole numbers). ₹1 = 100 paise. */

export function rupees(paise: number): string {
  const whole = Math.round(paise) / 100;
  const hasPaise = Math.round(paise) % 100 !== 0;
  return (
    "₹" +
    whole.toLocaleString("en-IN", {
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(" ");
}

/** Indian numbering: crore, lakh, thousand. 120000 → "one lakh twenty thousand". */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("Whole, non-negative numbers only.");
  if (n === 0) return "zero";
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${numberInWords(crore)} crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** For receipts: "Rupees one thousand two hundred only". */
export function amountInWords(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = Math.round(paise % 100);
  const words = `Rupees ${numberInWords(r)}` + (p ? ` and ${numberInWords(p)} paise` : "") + " only";
  return words;
}
