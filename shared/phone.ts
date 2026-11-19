/** Mobile numbers: a country code plus the number itself (digits only, at most 10). */

export const COUNTRY_CODES: [string, string][] = [
  ["91", "India"], ["971", "UAE"], ["966", "Saudi Arabia"], ["974", "Qatar"], ["965", "Kuwait"], ["968", "Oman"],
  ["973", "Bahrain"], ["94", "Sri Lanka"], ["65", "Singapore"], ["60", "Malaysia"], ["44", "UK"], ["1", "USA / Canada"],
  ["61", "Australia"],
];

/** Returns an error to show, or null when the number is fine. */
export function checkPhone(cc: string, phone: string): string | null {
  if (!COUNTRY_CODES.some(([c]) => c === cc)) return "Choose the country code.";
  if (!/^\d+$/.test(phone)) return "Enter the mobile number using digits only.";
  if (cc === "91") return /^[6-9]\d{9}$/.test(phone) ? null : "An Indian mobile number has 10 digits and starts with 6, 7, 8 or 9.";
  return phone.length >= 7 && phone.length <= 10 ? null : "Mobile number should be 7 to 10 digits.";
}

/** "+91 98400 12345" */
export function formatPhone(cc: string | null | undefined, phone: string) {
  if (!phone) return "";
  const c = cc || "91";
  return c === "91" && phone.length === 10 ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : `+${c} ${phone}`;
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
