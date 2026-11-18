/** WhatsApp messages: sent by opening WhatsApp with the text ready, so the doctor taps Send. */

export type MessageKind = "reminder" | "recall" | "balance" | "lab_ready";
export type Templates = Record<MessageKind, string>;

export const KIND_LABEL: Record<MessageKind, string> = {
  reminder: "Appointment reminder",
  recall: "Check-up recall",
  balance: "Balance due",
  lab_ready: "Lab work ready",
};

/** The words a template can use, wrapped in {curly brackets}. */
export const PLACEHOLDERS: Record<MessageKind, string[]> = {
  reminder: ["name", "day", "time", "visit", "clinic", "doctor", "phone"],
  recall: ["name", "last", "clinic", "doctor", "phone"],
  balance: ["name", "amount", "upi", "clinic", "doctor", "phone"],
  lab_ready: ["name", "work", "clinic", "doctor", "phone"],
};

export const DEFAULT_TEMPLATES: Templates = {
  reminder: "Hello {name}, this is a reminder of your {visit} appointment at {clinic} on {day} at {time}. Please reply here if you need to change the time. – {doctor}",
  recall: "Hello {name}, your last visit to {clinic} was in {last}. A check-up and cleaning every 6 months keeps teeth and gums healthy. Reply here and we’ll book a time that suits you. – {doctor}",
  balance: "Hello {name}, a balance of {amount} is pending for your treatment at {clinic}. You can pay at your next visit, or by UPI to {upi}. Thank you! – {doctor}",
  lab_ready: "Hello {name}, your {work} is back from the lab and ready at {clinic}. Please reply here to book a time to have it fitted. – {doctor}",
};

/** Puts the values into a template. Unknown or empty words are left out neatly. */
export function fill(template: string, vars: Record<string, string | undefined | null>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k]?.trim() ?? "")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** A WhatsApp click-to-chat link for an Indian 10-digit mobile number. */
export function waLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}
