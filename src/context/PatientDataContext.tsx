import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { collection, onSnapshot, type DocumentData, type QuerySnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { allPaymentsCleared as allPaymentsClearedFor, purposePaymentByVisit, type PaymentPurpose } from "@/lib/firestore-helpers";

export interface Patient {
  id: string;
  patient_code: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone_number: string;
  insurance_number: string | null;
  visit_reason: string;
  registered_at: string;
  registered_by: string;
}
export interface Visit {
  id: string;
  patient_id: string;
  status: string;
  visit_date: string;
  created_by: string;
  lab_returned_at?: string | null;
  discharged_at?: string | null;
  discharged_by?: string | null;
}
export interface Payment {
  id: string;
  payment_id?: string;
  receipt_number: string;
  patient_id: string;
  visit_id: string;
  purpose?: PaymentPurpose;
  lab_request_ids?: string[];
  prescription_ids?: string[];
  method: string | null;
  insurance_provider: string | null;
  insurance_number?: string | null;
  mpesa_reference?: string | null;
  phone_number?: string | null;
  amount: number;
  status: string;
  processed_by: string | null;
  processed_at: string | null;
  created_by?: string;
  created_at?: string;
}
export interface TriageRecord {
  id: string;
  patient_id: string;
  visit_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature: number | null;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  pulse: number | null;
  oxygen_saturation: number | null;
  blood_sugar: number | null;
  chief_complaint: string | null;
  priority: string;
  recorded_by: string;
  recorded_at: string;
}
export interface Consultation {
  id: string;
  patient_id: string;
  visit_id: string;
  presenting_complaint: string | null;
  history_of_presenting_illness: string | null;
  examination_findings: string | null;
  diagnosis: string | null;
  treatment_plan: string | null;
  consulted_by: string;
  consulted_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
}
export interface LabRequest {
  id: string;
  lab_code: string;
  patient_id: string;
  visit_id: string;
  consultation_id: string | null;
  test_type: string;
  status: string;
  lab_status?: string;
  results_received?: boolean;
  result_details?: string | null;
  result_status?: string | null;
  requested_by: string;
  requested_at: string;
}
export interface LabResult {
  id: string;
  lab_request_id: string;
  patient_id: string;
  result_details: string;
  reference_range: string | null;
  result_status: string;
  notes: string | null;
  uploaded_by: string;
  uploaded_at: string;
}
export interface Prescription {
  id: string;
  rx_code: string;
  patient_id: string;
  visit_id: string;
  consultation_id: string | null;
  medications: Array<{
    medicationName: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string;
  }>;
  issued_by: string;
  issued_at: string;
  dispensed: boolean;
  dispensed_by: string | null;
  dispensed_at: string | null;
  notes: string | null;
}
export interface InventoryItem {
  id: string;
  medication_name: string;
  category: string;
  stock_level: number;
  unit: string;
  reorder_level: number;
  status: string;
}
export interface OutboundNotification {
  id: string;
  provider: string;
  channel?: string;
  recipient_email: string;
  patient_id: string;
  visit_id: string;
  payment_id: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  delivered_at?: string | null;
  delivered_by?: string | null;
}

interface DataCtx {
  patients: Patient[];
  visits: Visit[];
  payments: Payment[];
  triageRecords: TriageRecord[];
  consultations: Consultation[];
  labRequests: LabRequest[];
  labResults: LabResult[];
  prescriptions: Prescription[];
  inventory: InventoryItem[];
  outboundNotifications: OutboundNotification[];
  patientById: (id: string) => Patient | undefined;
  triageByVisit: (visitId: string) => TriageRecord | undefined;
  paymentByVisit: (visitId: string) => Payment | undefined;
  paymentsByVisit: (visitId: string) => Payment[];
  paymentByVisitAndPurpose: (visitId: string, purpose: PaymentPurpose) => Payment | undefined;
  allPaymentsCleared: (visitId: string) => boolean;
  consultationByVisit: (visitId: string) => Consultation | undefined;
}

const Ctx = createContext<DataCtx | null>(null);

function useCollection<T>(name: string, enabled: boolean): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const unsub = onSnapshot(collection(db, name), (snap: QuerySnapshot<DocumentData>) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T));
    });
    return () => unsub();
  }, [name, enabled]);
  return rows;
}

export function PatientDataProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const patients = useCollection<Patient>("patients", isAuthenticated);
  const visits = useCollection<Visit>("visits", isAuthenticated);
  const payments = useCollection<Payment>("payments", isAuthenticated);
  const triageRecords = useCollection<TriageRecord>("triage_records", isAuthenticated);
  const consultations = useCollection<Consultation>("consultations", isAuthenticated);
  const labRequests = useCollection<LabRequest>("lab_requests", isAuthenticated);
  const labResults = useCollection<LabResult>("lab_results", isAuthenticated);
  const prescriptions = useCollection<Prescription>("prescriptions", isAuthenticated);
  const inventory = useCollection<InventoryItem>("inventory", isAuthenticated);
  const outboundNotifications = useCollection<OutboundNotification>("outbound_notifications", isAuthenticated);

  const value: DataCtx = {
    patients, visits, payments, triageRecords, consultations,
    labRequests, labResults, prescriptions, inventory, outboundNotifications,
    patientById: (id) => patients.find((p) => p.id === id),
    triageByVisit: (visitId) => triageRecords.find((t) => t.visit_id === visitId),
    paymentByVisit: (visitId) => purposePaymentByVisit(payments, visitId, "Registration"),
    paymentsByVisit: (visitId) => payments.filter((p) => p.visit_id === visitId),
    paymentByVisitAndPurpose: (visitId, purpose) => purposePaymentByVisit(payments, visitId, purpose),
    allPaymentsCleared: (visitId) => allPaymentsClearedFor(payments, visitId),
    consultationByVisit: (visitId) => consultations.find((c) => c.visit_id === visitId),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePatientData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePatientData must be used inside PatientDataProvider");
  return ctx;
}

export const VISIT_STATUSES = [
  "Waiting", "Awaiting Insurance Approval", "Waiting for Triage", "In Triage", "Waiting for Consultation",
  "In Consultation", "Waiting for Lab Payment", "In Lab", "Waiting for Pharmacy", "In Pharmacy",
  "Waiting for Pharmacy Payment", "Ready for Discharge", "Discharged",
] as const;
