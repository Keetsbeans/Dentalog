import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/*
 * Conventions
 * - Every row belongs to a clinic, so a second clinic or branch never needs a rebuild.
 * - Money is stored in paise (₹1 = 100) as whole numbers, never as decimals.
 * - Times are ISO 8601 strings in UTC; the app shows them in India time.
 * - "Deleting" sets deletedAt. The row sits in Recently deleted for 30 days,
 *   then the nightly job removes it for good (see worker/purge.ts).
 */

const id = () => text("id").primaryKey();
const clinicId = () => text("clinic_id").notNull().references(() => clinics.id);
const createdAt = () => text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const softDelete = {
  deletedAt: text("deleted_at"),
  deletedReason: text("deleted_reason"),
};

export const clinics = sqliteTable("clinics", {
  id: id(),
  name: text("name").notNull(),
  doctorName: text("doctor_name").notNull(),
  qualification: text("qualification"),
  phone: text("phone"),
  address: text("address"),
  email: text("email"),
  website: text("website"),
  upiId: text("upi_id"),
  /** Weekly hours, e.g. {"mon":["15:30","20:30"], ..., "sun":null} */
  hoursJson: text("hours_json").notNull().default("{}"),
  /** Price list, medicines, sets, visit types and labs edited in Settings. Empty keys fall back to defaults. */
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: createdAt(),
});

export const patients = sqliteTable(
  "patients",
  {
    id: id(),
    clinicId: clinicId(),
    /** Carries on from the old software: CJ963, CJ964, ... */
    code: text("code").notNull(),
    /** Paper file number: DCJ-1986, ... */
    fileNo: text("file_no"),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    gender: text("gender", { enum: ["F", "M", "O"] }),
    birthYear: integer("birth_year"),
    /** Medical alerts shown in red on every screen, e.g. ["Diabetic","Penicillin allergy"] */
    alertsJson: text("alerts_json").notNull().default("[]"),
    notes: text("notes"),
    whatsappConsent: integer("whatsapp_consent", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [
    uniqueIndex("patients_clinic_code").on(t.clinicId, t.code),
    index("patients_phone").on(t.clinicId, t.phone),
  ],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    startsAt: text("starts_at").notNull(),
    minutes: integer("minutes").notNull(),
    visitType: text("visit_type").notNull(),
    status: text("status", {
      enum: ["booked", "arrived", "in_chair", "done", "no_show", "cancelled"],
    }).notNull().default("booked"),
    /** Booked over a taken slot for an emergency. */
    squeezedIn: integer("squeezed_in", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [index("appointments_day").on(t.clinicId, t.startsAt)],
);

export const visits = sqliteTable(
  "visits",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    appointmentId: text("appointment_id").references(() => appointments.id),
    vitalsJson: text("vitals_json").notNull().default("{}"),
    /** FDI tooth numbers the visit is about, e.g. "16" or "36, 37". */
    tooth: text("tooth"),
    complaint: text("complaint"),
    findingsJson: text("findings_json").notNull().default("[]"),
    diagnosisJson: text("diagnosis_json").notNull().default("[]"),
    notes: text("notes"),
    /** One-tap advice phrases plus free text, printed on the prescription. */
    adviceJson: text("advice_json").notNull().default("[]"),
    adviceNote: text("advice_note"),
    nextVisit: text("next_visit"),
    /** Once signed the note is locked; later changes are addenda. */
    signedAt: text("signed_at"),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [index("visits_patient").on(t.patientId)],
);

export const prescriptionItems = sqliteTable("prescription_items", {
  id: id(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  drug: text("drug").notNull(),
  /** What is in it, printed under the brand name, e.g. "Azithromycin 500 mg · tablet". */
  generic: text("generic"),
  /** Morning-afternoon-night, e.g. "1-0-1", or "SOS". */
  dose: text("dose").notNull(),
  days: integer("days"),
  food: text("food", { enum: ["after", "before", "any"] }).notNull().default("after"),
  /** Written from dose/days/food so the printout always matches. */
  instruction: text("instruction").notNull(),
  quantity: integer("quantity"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    /** INV-0029 ... never reused, even after deletion. */
    number: text("number").notNull(),
    issuedAt: text("issued_at").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [uniqueIndex("invoices_clinic_number").on(t.clinicId, t.number)],
);

export const invoiceLines = sqliteTable("invoice_lines", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  service: text("service").notNull(),
  tooth: text("tooth"),
  amountPaise: integer("amount_paise").notNull(),
});

export const receipts = sqliteTable(
  "receipts",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    invoiceId: text("invoice_id").references(() => invoices.id),
    /** RCPT27 ... never reused, even after deletion. */
    number: text("number").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    mode: text("mode", { enum: ["cash", "upi", "card", "insurance", "emi"] }).notNull(),
    reference: text("reference"),
    receivedAt: text("received_at").notNull(),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [uniqueIndex("receipts_clinic_number").on(t.clinicId, t.number)],
);

export const labOrders = sqliteTable("lab_orders", {
  id: id(),
  clinicId: clinicId(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  number: text("number").notNull(),
  lab: text("lab").notNull(),
  work: text("work").notNull(),
  tooth: text("tooth"),
  shade: text("shade"),
  sentOn: text("sent_on").notNull(),
  dueOn: text("due_on").notNull(),
  status: text("status", { enum: ["sent", "received", "fitted"] }).notNull().default("sent"),
  billPaise: integer("bill_paise").notNull().default(0),
  paidPaise: integer("paid_paise").notNull().default(0),
  createdAt: createdAt(),
  ...softDelete,
});

/** X-rays, photos, consent forms. The file itself lives in R2 under `r2Key`. */
export const files = sqliteTable("files", {
  id: id(),
  clinicId: clinicId(),
  patientId: text("patient_id").references(() => patients.id),
  visitId: text("visit_id").references(() => visits.id),
  kind: text("kind", { enum: ["xray", "photo", "consent", "document", "letterhead"] }).notNull(),
  tooth: text("tooth"),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: createdAt(),
  ...softDelete,
});

/** Next number for each series, so INV/RCPT/CJ numbers continue from the old software. */
export const counters = sqliteTable(
  "counters",
  {
    clinicId: clinicId(),
    series: text("series", { enum: ["patient", "file", "invoice", "receipt", "lab"] }).notNull(),
    next: integer("next").notNull(),
  },
  (t) => [uniqueIndex("counters_pk").on(t.clinicId, t.series)],
);

/** Who did what and when: views, edits, deletes, restores, prints. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clinicId: clinicId(),
    at: createdAt(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    detail: text("detail"),
  },
  (t) => [index("audit_entity").on(t.entity, t.entityId)],
);
