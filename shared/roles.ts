/** Who can do what. The server checks these on every request; the screens use them to hide what a role can't use. */

export type Role = "owner" | "doctor" | "reception";
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", doctor: "Doctor", reception: "Receptionist" };

export type Perm =
  | "clinical.write"   // visit notes, prescriptions, tooth chart, addenda
  | "alerts.edit"      // change a patient's medical alerts
  | "billing.view"     // see bills and payments
  | "billing.take"     // make a bill, take a payment, print a receipt
  | "billing.edit"     // discounts, change a bill after it's made
  | "money.totals"     // collected today, still to collect, reports
  | "delete"           // delete anything, Recently deleted
  | "messages.send"    // send WhatsApp messages and reminders
  | "lab.write"        // create and change lab orders (everyone can mark sent/received)
  | "files.edit"       // change a file's type, tooth or note
  | "settings";        // settings, price list, staff, export, activity log

const DOCTOR: Perm[] = ["clinical.write", "alerts.edit", "billing.view", "billing.take", "lab.write", "files.edit"];

/** `receptionBilling`: the clinic's choice of whether the front desk takes payments. */
export function perms(role: Role, opts: { receptionBilling?: boolean } = {}): Perm[] {
  if (role === "owner") return ["clinical.write", "alerts.edit", "billing.view", "billing.take", "billing.edit", "money.totals", "delete", "messages.send", "lab.write", "files.edit", "settings"];
  if (role === "doctor") return DOCTOR;
  return opts.receptionBilling ? ["billing.view", "billing.take"] : [];
}

export const can = (role: Role, perm: Perm, opts?: { receptionBilling?: boolean }) => perms(role, opts).includes(perm);
