/** WhatsApp messages: sent by opening WhatsApp with the text ready, so the doctor taps Send. */

export type MessageKind = "reminder" | "soon" | "recall" | "balance" | "lab_ready" | "care" | "review";
export type Templates = Record<MessageKind, string>;
export const KINDS: MessageKind[] = ["reminder", "soon", "lab_ready", "balance", "recall", "care", "review"];

export const KIND_LABEL: Record<MessageKind, string> = {
  reminder: "Day-before reminder",
  soon: "Same-day reminder",
  recall: "Check-up recall",
  balance: "Balance due",
  lab_ready: "Lab work ready",
  care: "Care after extraction",
  review: "Ask for a review",
};

/** The words a template can use, wrapped in {curly brackets}. */
export const PLACEHOLDERS: Record<MessageKind, string[]> = {
  reminder: ["name", "day", "time", "visit", "link", "clinic", "phone"],
  soon: ["name", "time", "visit", "link", "clinic", "phone"],
  recall: ["name", "last", "clinic", "phone"],
  balance: ["name", "amount", "upi", "clinic", "phone"],
  lab_ready: ["name", "work", "clinic", "phone"],
  care: ["name", "clinic", "phone"],
  review: ["name", "review", "clinic"],
};

/** Written as the clinic's automated service, not as a personal note from the doctor. */
export const DEFAULT_TEMPLATES: Templates = {
  reminder: "Hello {name}, this is an appointment reminder from {clinic}.\n\nYour {visit} appointment is on {day} at {time}.\n\nPlease confirm, or ask for another time, here: {link}\n\n(Automated message from {clinic}. For anything else, call {phone}.)",
  soon: "Hello {name}, your {visit} appointment at {clinic} is today at {time}. We look forward to seeing you.\n\nRunning late or can’t come? Let us know here: {link}\n\n(Automated message from {clinic})",
  recall: "Hello {name}, this is {clinic}. Your last check-up with us was in {last}. A check-up and cleaning every 6 months keeps teeth and gums healthy.\n\nReply to this message or call {phone} to book a time.\n\n(Automated message from {clinic})",
  balance: "Hello {name}, this is {clinic}. A balance of {amount} is pending on your treatment bill. You can pay at your next visit, or by UPI to {upi}.\n\nThank you.\n(Automated message from {clinic})",
  lab_ready: "Hello {name}, this is {clinic}. Your {work} has arrived from the lab and is ready to be fitted.\n\nReply to this message or call {phone} to book a time.\n\n(Automated message from {clinic})",
  care: "Hello {name}, care instructions from {clinic} after your extraction today:\n• Bite on the gauze for 45 minutes.\n• No spitting, rinsing, smoking or hot drinks today.\n• Eat soft, cool food for 24 hours.\n• From tomorrow, rinse gently with warm salt water after meals.\nCall {phone} if bleeding doesn’t stop or swelling increases.",
  review: "Hello {name}, thank you for visiting {clinic}. If you were happy with your care, a short Google review would help others find us: {review}",
};

/** Puts the values into a template. Unknown or empty words are left out neatly. */
export function fill(template: string, vars: Record<string, string | undefined | null>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k]?.trim() ?? "")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** A WhatsApp click-to-chat link. `cc` is the country code without the +. */
export function waLink(cc: string, phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (cc === "91" ? !/^[6-9]\d{9}$/.test(digits) : digits.length < 7 || digits.length > 10) return null;
  return `https://wa.me/${cc}${digits}?text=${encodeURIComponent(text)}`;
}
