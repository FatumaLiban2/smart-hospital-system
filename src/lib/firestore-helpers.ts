import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import type { Payment, Visit, OutboundNotification } from "@/context/PatientDataContext";

// Auto-incrementing human-readable code generator (PAT-001, RCP-001, ...).
export async function nextCode(prefix: string, counterId: string): Promise<string> {
  const ref = doc(db, "counters", counterId);
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data().value as number) : 0;
    const next = current + 1;
    tx.set(ref, { value: next });
    return `${prefix}-${String(next).padStart(3, "0")}`;
  });
}

export function recomputeInventoryStatus(stock: number, reorder: number) {
  if (stock <= 0) return "Out of Stock";
  if (stock <= reorder) return "Low Stock";
  return "In Stock";
}

export type PaymentMethod = "Cash" | "MPesa" | "Insurance";

export function validInsuranceNumber(value: string) {
  return /^\d{8,12}$/.test(value.trim());
}

export function canProceedToService(payment: { method: string | null; status: string } | null | undefined, insuranceNumber?: string | null) {
  if (!payment) return false;
  if (payment.method === "Insurance") return payment.status === "Approved" && validInsuranceNumber(insuranceNumber ?? "");
  return payment.status === "Paid";
}

// --- Payment purpose model -------------------------------------------------
// Payments are no longer one-per-visit: a Registration payment is created at
// check-in, and Lab/Pharmacy payment "stubs" (status "Unbilled", no method/amount
// yet) are generated automatically when a lab test is requested or medication is
// dispensed, then settled in place by the Receptionist.

export type PaymentPurpose = "Registration" | "Lab" | "Pharmacy";

export function isPaymentCleared(payment: { method: string | null; status: string } | null | undefined): boolean {
  if (!payment) return false;
  if (payment.method === "Insurance") return payment.status === "Approved";
  return payment.status === "Paid";
}

// Legacy payment docs predate the `purpose` field; treat those as Registration.
export function purposeOf(payment: { purpose?: PaymentPurpose }): PaymentPurpose {
  return payment.purpose ?? "Registration";
}

export function purposePaymentByVisit<T extends { visit_id: string; purpose?: PaymentPurpose }>(
  payments: T[],
  visitId: string,
  purpose: PaymentPurpose,
): T | undefined {
  return payments.find((p) => p.visit_id === visitId && purposeOf(p) === purpose);
}

// The stub the receptionist can act on next for this visit+purpose: either
// never billed yet, or a previous attempt (e.g. insurance) was rejected.
export function billablePayment<T extends { visit_id: string; purpose?: PaymentPurpose; status: string }>(
  payments: T[],
  visitId: string,
  purpose: PaymentPurpose,
): T | undefined {
  return payments.find(
    (p) => p.visit_id === visitId && purposeOf(p) === purpose && (p.status === "Unbilled" || p.status === "Rejected"),
  );
}

export function allPaymentsCleared<T extends { visit_id: string; method: string | null; status: string }>(
  payments: T[],
  visitId: string,
): boolean {
  const relevant = payments.filter((p) => p.visit_id === visitId);
  if (!relevant.length) return false;
  return relevant.every((p) => isPaymentCleared(p));
}

export function nextStatusAfterInsuranceSubmitted(purpose: PaymentPurpose): string {
  if (purpose === "Registration") return "Awaiting Insurance Approval";
  if (purpose === "Lab") return "Waiting for Lab Payment";
  return "Waiting for Pharmacy Payment";
}

export function nextStatusAfterPaymentCleared<T extends { visit_id: string; method: string | null; status: string }>(args: {
  purpose: PaymentPurpose;
  visitId: string;
  projectedPayments: T[];
}): string {
  if (args.purpose === "Registration") return "Waiting for Triage";
  if (args.purpose === "Lab") return "In Lab";
  return allPaymentsCleared(args.projectedPayments, args.visitId) ? "Ready for Discharge" : "Waiting for Pharmacy Payment";
}

// Stages a Lab payment stub onto a caller-owned batch (never commits itself) so
// it stays atomic with the lab_requests/visit-status writes in the same action.
// Extends an already-open stub for this visit instead of creating a new one each time.
export async function stageLabPaymentStub(
  batch: WriteBatch,
  args: { payments: Payment[]; visitId: string; patientId: string; labRequestIds: string[]; staffId: string },
) {
  const open = args.payments.find((p) => p.visit_id === args.visitId && purposeOf(p) === "Lab" && p.status === "Unbilled");
  if (open) {
    batch.update(doc(db, "payments", open.id), {
      lab_request_ids: Array.from(new Set([...(open.lab_request_ids ?? []), ...args.labRequestIds])),
    });
    return;
  }
  const payment_id = await nextCode("PAY", "payments_seq");
  const ref = doc(collection(db, "payments"));
  batch.set(ref, {
    payment_id,
    receipt_number: "",
    purpose: "Lab",
    patient_id: args.patientId,
    visit_id: args.visitId,
    lab_request_ids: args.labRequestIds,
    method: null,
    insurance_provider: null,
    amount: 0,
    status: "Unbilled",
    processed_by: null,
    processed_at: null,
    created_by: args.staffId,
    created_at: new Date().toISOString(),
  });
}

// Same as stageLabPaymentStub, for medication fees generated when the Pharmacist dispenses.
export async function stagePharmacyPaymentStub(
  batch: WriteBatch,
  args: { payments: Payment[]; visitId: string; patientId: string; prescriptionIds: string[]; staffId: string },
) {
  const open = args.payments.find((p) => p.visit_id === args.visitId && purposeOf(p) === "Pharmacy" && p.status === "Unbilled");
  if (open) {
    batch.update(doc(db, "payments", open.id), {
      prescription_ids: Array.from(new Set([...(open.prescription_ids ?? []), ...args.prescriptionIds])),
    });
    return;
  }
  const payment_id = await nextCode("PAY", "payments_seq");
  const ref = doc(collection(db, "payments"));
  batch.set(ref, {
    payment_id,
    receipt_number: "",
    purpose: "Pharmacy",
    patient_id: args.patientId,
    visit_id: args.visitId,
    prescription_ids: args.prescriptionIds,
    method: null,
    insurance_provider: null,
    amount: 0,
    status: "Unbilled",
    processed_by: null,
    processed_at: null,
    created_by: args.staffId,
    created_at: new Date().toISOString(),
  });
}

// The single place an Insurance payment flips to Approved — used by both the
// receptionist's manual Approve button and the demo auto-approval timer. Guards
// on current status so a manual click racing the timer is a harmless no-op.
export async function settleInsuranceApproval(args: {
  paymentId: string;
  payments: Payment[];
  visits: Visit[];
  outboundNotifications: OutboundNotification[];
  approvedBy: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const payment = args.payments.find((p) => p.id === args.paymentId);
  if (!payment || payment.status !== "Pending Approval") return { ok: false, reason: "not-pending" };
  const visit = args.visits.find((v) => v.id === payment.visit_id);
  if (!visit) return { ok: false, reason: "visit-missing" };
  const purpose = purposeOf(payment);
  const projected = args.payments.map((p) => (p.id === payment.id ? { ...p, status: "Approved" } : p));
  const nextStatus = nextStatusAfterPaymentCleared({ purpose, visitId: visit.id, projectedPayments: projected });
  const notification = args.outboundNotifications.find((n) => n.payment_id === payment.id);
  const batch = writeBatch(db);
  batch.update(doc(db, "payments", payment.id), { status: "Approved" });
  batch.update(doc(db, "visits", visit.id), { status: nextStatus });
  if (notification) {
    batch.update(doc(db, "outbound_notifications", notification.id), {
      status: "Sent",
      delivered_at: new Date().toISOString(),
      delivered_by: args.approvedBy ?? "system-auto-approval",
    });
  }
  await batch.commit();
  return { ok: true };
}

export async function rejectInsuranceClaim(paymentId: string) {
  await updateDoc(doc(db, "payments", paymentId), { status: "Rejected" });
}

const INSURANCE_PROVIDER_EMAILS: Record<string, string> = {
  "SHA/NHIF": "claims@sha.go.ke",
  AAR: "claims@aar.co.ke",
  Britam: "claims@britam.co.ke",
  Jubilee: "claims@jubileeinsurance.co.ke",
  CIC: "claims@cic.co.ke",
  Other: "claims@insurance-provider.local",
};

export function insuranceProviderEmail(provider: string) {
  return INSURANCE_PROVIDER_EMAILS[provider] ?? INSURANCE_PROVIDER_EMAILS.Other;
}

export function buildInsuranceNotificationPayload(args: {
  provider: string;
  patient: { id: string; patient_code: string; first_name: string; last_name: string; insurance_number: string | null };
  visit: { id: string; visit_date: string; status: string };
  payment: { id: string; receipt_number: string; amount: number; status: string; processed_at: string };
  staff: { staff_id: string; display_name: string };
}) {
  const recipient = insuranceProviderEmail(args.provider);
  const subject = `New insurance claim for ${args.patient.patient_code}`;
  const body = [
    `Insurance provider: ${args.provider}`,
    `Recipient: ${recipient}`,
    `Patient: ${args.patient.first_name} ${args.patient.last_name} (${args.patient.patient_code})`,
    `Insurance number: ${args.patient.insurance_number ?? "—"}`,
    `Visit: ${args.visit.id}`,
    `Receipt: ${args.payment.receipt_number}`,
    `Amount: KES ${Number(args.payment.amount).toLocaleString()}`,
    `Processed by: ${args.staff.display_name} (${args.staff.staff_id})`,
    `Processed at: ${args.payment.processed_at}`,
  ].join("\n");

  return {
    channel: "Insurance Inbox",
    recipient_email: recipient,
    provider: args.provider,
    patient_id: args.patient.id,
    visit_id: args.visit.id,
    payment_id: args.payment.id,
    subject,
    body,
    status: "Queued",
    created_at: new Date().toISOString(),
    delivered_at: null,
    delivered_by: null,
  };
}

export function matchInventoryItem(medicationName: string, inventory: Array<{ id: string; medication_name: string }>) {
  const target = medicationName.trim().toLowerCase();
  return inventory.find((item) => {
    const name = item.medication_name.trim().toLowerCase();
    return name === target || name.includes(target) || target.includes(name);
  });
}

export function buildDailyReportSummary(args: {
  date: string;
  generatedAt: string;
  patients: number;
  visits: number;
  payments: number;
  triageRecords: number;
  consultations: number;
  labRequests: number;
  labResults: number;
  prescriptions: number;
  inventory: Array<{ medication_name: string; stock_level: number; status: string }>;
}) {
  return {
    generatedAt: args.generatedAt,
    date: args.date,
    metrics: {
      patients: args.patients,
      visits: args.visits,
      payments: args.payments,
      triageRecords: args.triageRecords,
      consultations: args.consultations,
      labRequests: args.labRequests,
      labResults: args.labResults,
      prescriptions: args.prescriptions,
    },
    inventory: args.inventory,
  };
}

const SEED_INVENTORY = [
  { medication_name: "Paracetamol 500mg", category: "Analgesic", stock_level: 500, unit: "tablets", reorder_level: 50 },
  { medication_name: "Ibuprofen 400mg", category: "Analgesic", stock_level: 300, unit: "tablets", reorder_level: 50 },
  { medication_name: "Amoxicillin 500mg", category: "Antibiotic", stock_level: 200, unit: "capsules", reorder_level: 50 },
  { medication_name: "Ciprofloxacin 500mg", category: "Antibiotic", stock_level: 150, unit: "tablets", reorder_level: 50 },
  { medication_name: "Metronidazole 400mg", category: "Antibiotic", stock_level: 180, unit: "tablets", reorder_level: 50 },
  { medication_name: "Azithromycin 250mg", category: "Antibiotic", stock_level: 120, unit: "tablets", reorder_level: 50 },
  { medication_name: "Cetirizine 10mg", category: "Antihistamine", stock_level: 250, unit: "tablets", reorder_level: 50 },
  { medication_name: "Loratadine 10mg", category: "Antihistamine", stock_level: 220, unit: "tablets", reorder_level: 50 },
  { medication_name: "Omeprazole 20mg", category: "Antacid", stock_level: 180, unit: "capsules", reorder_level: 50 },
  { medication_name: "Ranitidine 150mg", category: "Antacid", stock_level: 150, unit: "tablets", reorder_level: 50 },
  { medication_name: "Salbutamol Inhaler", category: "Bronchodilator", stock_level: 60, unit: "inhalers", reorder_level: 50 },
  { medication_name: "ORS Sachets", category: "Rehydration", stock_level: 400, unit: "sachets", reorder_level: 50 },
  { medication_name: "Diclofenac 50mg", category: "NSAID", stock_level: 240, unit: "tablets", reorder_level: 50 },
  { medication_name: "Artemether/Lumefantrine", category: "Antimalarial", stock_level: 100, unit: "tablets", reorder_level: 50 },
  { medication_name: "Quinine 300mg", category: "Antimalarial", stock_level: 80, unit: "tablets", reorder_level: 50 },
  { medication_name: "Multivitamin", category: "Supplement", stock_level: 300, unit: "tablets", reorder_level: 50 },
  { medication_name: "Ferrous Sulphate", category: "Supplement", stock_level: 250, unit: "tablets", reorder_level: 50 },
  { medication_name: "Folic Acid 5mg", category: "Supplement", stock_level: 280, unit: "tablets", reorder_level: 50 },
  { medication_name: "Metformin 500mg", category: "Antidiabetic", stock_level: 200, unit: "tablets", reorder_level: 50 },
  { medication_name: "Oral Contraceptives", category: "Contraceptive", stock_level: 120, unit: "packs", reorder_level: 50 },
];

let inventorySeeded = false;
export async function ensureInventorySeeded() {
  if (inventorySeeded) return;
  const existing = await getDocs(query(collection(db, "inventory"), limit(1)));
  if (!existing.empty) { inventorySeeded = true; return; }
  const batch = writeBatch(db);
  for (const item of SEED_INVENTORY) {
    const ref = doc(collection(db, "inventory"));
    batch.set(ref, { ...item, status: recomputeInventoryStatus(item.stock_level, item.reorder_level) });
  }
  await batch.commit();
  inventorySeeded = true;
}

export interface DemoStaff {
  email: string;
  staff_id: string;
  role: "Receptionist" | "TriageNurse" | "Clinician" | "LabTechnician" | "Pharmacist";
  first_name: string;
  last_name: string;
}

export const DEMO_STAFF: Record<string, DemoStaff> = {
  "receptionist@hospital.com": { email: "receptionist@hospital.com", staff_id: "REC-001", role: "Receptionist", first_name: "Mary", last_name: "Wanjiru" },
  "triage@hospital.com": { email: "triage@hospital.com", staff_id: "TRN-001", role: "TriageNurse", first_name: "John", last_name: "Kamau" },
  "clinician@hospital.com": { email: "clinician@hospital.com", staff_id: "CLN-001", role: "Clinician", first_name: "Dr. James", last_name: "Otieno" },
  "lab@hospital.com": { email: "lab@hospital.com", staff_id: "LAB-001", role: "LabTechnician", first_name: "Grace", last_name: "Muthoni" },
  "pharmacist@hospital.com": { email: "pharmacist@hospital.com", staff_id: "PHM-001", role: "Pharmacist", first_name: "Peter", last_name: "Njoroge" },
};

// Sign in; if the demo account doesn't exist yet, create it. Then upsert the staff profile doc.
export async function signInOrSeedDemoUser(email: string, password: string) {
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? "";
    const seed = DEMO_STAFF[email.toLowerCase()];
    if (seed && (code === "auth/user-not-found" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials")) {
      try {
        cred = await createUserWithEmailAndPassword(auth, email, password);
      } catch (createErr: unknown) {
        const cCode = (createErr as { code?: string })?.code ?? "";
        if (cCode === "auth/email-already-in-use") {
          // password mismatch
          throw new Error("Invalid password for existing account");
        }
        throw createErr;
      }
    } else {
      throw err;
    }
  }
  const user = cred.user;
  const seed = DEMO_STAFF[email.toLowerCase()];
  if (seed) {
    const ref = doc(db, "staff", user.uid);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, { ...seed, user_id: user.uid, created_at: new Date().toISOString() });
    }
  }
  return user;
}
