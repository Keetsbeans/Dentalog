import type { Patient, VisitBundle } from "../lib/api";
import type { ReceiptData } from "./PrintSheet";

/** A made-up patient for the layout preview and the test page. */
const PATIENT: Patient & { notes: string | null } = {
  id: "sample", code: "CJ000", fileNo: null, name: "Sample Patient", phone: "9840000000", phoneCc: "91",
  email: null, emailConfirmedAt: null, notes: null, gender: "F", birthYear: new Date().getFullYear() - 42,
  alerts: ["Diabetic", "Penicillin allergy"], createdAt: new Date().toISOString(),
};
const now = new Date().toISOString();

export const SAMPLE_RX: VisitBundle = {
  patient: PATIENT, addenda: [],
  visit: {
    id: "sample", patientId: "sample", appointmentId: null, createdAt: now, signedAt: now, vitals: {}, tooth: "16",
    complaint: null, findings: [], diagnosis: ["Irreversible pulpitis"], notes: null,
    advice: ["Avoid chewing on the right side until your next sitting"], adviceNote: null, nextVisit: "RCT sitting 2, in 1 week",
  },
  items: [
    { drug: "Tab. Augmentin 625", generic: "Amoxicillin + clavulanic acid", dose: "1-0-1", days: 5, food: "after", instruction: "Morning and night, after food", quantity: 10 },
    { drug: "Tab. Zerodol-P", generic: "Aceclofenac + paracetamol", dose: "1-0-1", days: 3, food: "after", instruction: "Morning and night, after food", quantity: 6 },
  ],
};

export const SAMPLE_RECEIPT: ReceiptData = {
  patient: PATIENT, inWords: "Rupees Three Thousand Only",
  receipt: { id: "sample", number: "RCPT00", amountPaise: 300000, mode: "upi", reference: null, receivedAt: now, invoiceId: "sample" },
  invoice: {
    id: "sample", number: "INV-0000", issuedAt: now, totalPaise: 450000, discountPaise: 0, paidPaise: 300000, balancePaise: 150000,
    patient: { id: "sample", name: PATIENT.name, code: PATIENT.code, phone: PATIENT.phone },
    lines: [{ id: "a", service: "Root canal treatment", tooth: "16", amountPaise: 450000 }], receipts: [], edits: [],
  },
};
