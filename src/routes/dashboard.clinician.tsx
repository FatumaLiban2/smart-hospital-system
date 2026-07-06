import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildDailyReportSummary, canProceedToService, matchInventoryItem, nextCode, purposePaymentByVisit, stageLabPaymentStub } from "@/lib/firestore-helpers";
import { useAuth } from "@/context/AuthContext";
import { usePatientData, type LabRequest, type Payment } from "@/context/PatientDataContext";
import { RoleGuard, RoleHeader, FlowTracker, StatCard, Tabs, Empty, Spinner, Field, inputCls, useToast, isToday, ageFromDob, priorityBadge, statusBadge } from "@/components/his/shared";
import { Plus, X, Download } from "lucide-react";

export const Route = createFileRoute("/dashboard/clinician")({ component: () => <RoleGuard role="Clinician"><Dashboard /></RoleGuard> });

export function paymentLabel(p?: Payment | null) {
  if (!p) return "Payment Pending";
  if (p.method === "Insurance" && p.status === "Pending") return `Insurance claim queued${p.insurance_provider ? ` (${p.insurance_provider})` : ""}`;
  if (p.status === "Pending") return "Payment Pending";
  if (p.method === "MPesa") return `Paid via M-Pesa (Ref: ${p.mpesa_reference ?? "—"})`;
  if (p.method === "Insurance") return `Paid via Insurance${p.insurance_provider ? ` (${p.insurance_provider})` : ""}`;
  if (p.method === "Cash") return "Paid via Cash";
  return p.status;
}

type Tab = "queue" | "consultation" | "results" | "prescriptions";

const LAB_TESTS = ["Full Blood Count","Malaria RDT","Urinalysis","Blood Glucose","Liver Function Test","Renal Function Test","HIV Test","Pregnancy Test","Stool Analysis","Sputum Culture","Other"];
const FREQS = ["Once Daily","Twice Daily","Three Times Daily","As Needed"];

function isLabRequestPending(request: LabRequest) {
  return request.status !== "Completed" && request.status !== "completed" && request.lab_status !== "completed" && !request.results_received;
}

function isLabRequestCompleted(request: LabRequest) {
  return request.status === "Completed" || request.lab_status === "completed" || request.results_received === true;
}

function Dashboard() {
  const { staff } = useAuth();
  const { patients, visits, triageRecords, payments, consultations, labRequests, labResults, prescriptions, inventory } = usePatientData();
  const { toast, ui } = useToast();
  const [tab, setTab] = useState<Tab>("queue");
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);

  const queue = useMemo(() => visits.filter((v) => {
    if (v.status !== "Waiting for Consultation") return false;
    const patient = patients.find((p) => p.id === v.patient_id);
    const payment = purposePaymentByVisit(payments, v.id, "Registration");
    return canProceedToService(payment, patient?.insurance_number);
  }), [patients, payments, visits]);
  const consultationsToday = consultations.filter((c) => isToday(c.consulted_at) && c.consulted_by === staff?.staff_id).length;
  const myLabRequestIds = useMemo(() => new Set(labRequests.filter((r) => r.requested_by === staff?.staff_id).map((r) => r.id)), [labRequests, staff?.staff_id]);
  const resultsToReview = labResults.filter((r) => myLabRequestIds.has(r.lab_request_id)).length;
  const pendingLab = labRequests.filter((r) => isLabRequestPending(r) && r.requested_by === staff?.staff_id).length;

  const downloadDailyReport = () => {
    const date = new Date().toISOString().slice(0, 10);
    const generatedAt = new Date().toISOString();
    const report = buildDailyReportSummary({
      date,
      generatedAt,
      patients: patients.length,
      visits: visits.filter((v) => isToday(v.visit_date)).length,
      payments: payments.filter((p) => isToday(p.processed_at)).length,
      triageRecords: triageRecords.filter((t) => isToday(t.recorded_at)).length,
      consultations: consultations.filter((c) => isToday(c.consulted_at)).length,
      labRequests: labRequests.filter((r) => isToday(r.requested_at)).length,
      labResults: labResults.filter((r) => isToday(r.uploaded_at)).length,
      prescriptions: prescriptions.filter((p) => isToday(p.issued_at)).length,
      inventory: inventory.map((item) => ({ medication_name: item.medication_name, stock_level: item.stock_level, status: item.status })),
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daily-report-${date}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <RoleHeader title="Clinician Dashboard" accent="bg-violet-600" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <FlowTracker />
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Waiting for Consultation" value={queue.length} tone="warn" />
          <StatCard label="Results to Review" value={resultsToReview} tone="ok" />
          <StatCard label="Consultations Today" value={consultationsToday} />
        </div>
        <div className="flex justify-end">
          <button onClick={downloadDailyReport} className="flex items-center gap-2 rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="size-4" /> Download Daily Report
          </button>
        </div>
        <Tabs accent="bg-violet-600" current={tab} onChange={(id) => setTab(id as Tab)} tabs={[{ id: "queue", label: "Patient Queue" }, { id: "consultation", label: "Results Review" }, { id: "results", label: "Lab Results" }, { id: "prescriptions", label: "Prescriptions Issued" }]} />
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {tab === "queue" ? (
            !queue.length ? <Empty /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Chief Complaint</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {queue.map((v) => {
                    const p = patients.find((x) => x.id === v.patient_id);
                    const tr = triageRecords.find((t) => t.visit_id === v.id);
                    if (!p) return null;
                    return (
                      <tr key={v.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{p.patient_code}</td>
                        <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                        <td className="px-3 py-2">{ageFromDob(p.date_of_birth)}</td>
                        <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs ${priorityBadge(tr?.priority)}`}>{tr?.priority ?? "—"}</span></td>
                        <td className="px-3 py-2">{tr?.chief_complaint ?? p.visit_reason}</td>
                        <td className="px-3 py-2">
                          <button onClick={async () => {
                            await updateDoc(doc(db, "visits", v.id), { status: "In Consultation" });
                            setActiveVisitId(v.id); setTab("consultation");
                          }} className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700">Start Consultation</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}
          {tab === "consultation" ? <ConsultationForm /> : null}
          {tab === "results" ? <ResultsTab /> : null}
          {tab === "prescriptions" ? <PrescriptionsTab /> : null}
        </div>
      </div>
      {ui}
    </div>
  );

  function ConsultationForm() {
    const [visitId, setVisitId] = useState(activeVisitId ?? "");
    const visit = visits.find((v) => v.id === visitId);
    const patient = visit ? patients.find((p) => p.id === visit.patient_id) : null;
    const triage = visit ? triageRecords.find((t) => t.visit_id === visit.id) : null;
    const payment = visit ? purposePaymentByVisit(payments, visit.id, "Registration") : null;
    const existingConsultation = visit ? consultations.find((c) => c.visit_id === visit.id) : null;
    const serviceCleared = canProceedToService(payment, patient?.insurance_number);
    const visitLabRequests = visit ? labRequests.filter((r) => r.visit_id === visit.id) : [];
    const visitLabResults = useMemo(() => {
      const reqIds = new Set(visitLabRequests.map((r) => r.id));
      return labResults.filter((r) => reqIds.has(r.lab_request_id));
    }, [labResults, visitLabRequests]);
    const reviewableVisits = useMemo(() => visits.filter((v) => {
      if (v.status !== "In Consultation" && v.status !== "Waiting for Pharmacy") return false;
      const consultation = consultations.find((c) => c.visit_id === v.id);
      return !!consultation || v.status === "Waiting for Pharmacy";
    }), [consultations, visits]);
    // Phase 2: labs have returned for this visit at least once. The form stays
    // editable and pre-filled in both phases — only the lab-ordering section and
    // required-field set differ.
    const isPostLabPhase = !!visit?.lab_returned_at;
    const hasCompletedLabResults = visitLabResults.length > 0 || visitLabRequests.some((request) => isLabRequestCompleted(request));

    const [form, setForm] = useState({ presenting_complaint: "", history_of_presenting_illness: "", examination_findings: "", diagnosis: "", treatment_plan: "" });
    const [errs, setErrs] = useState<Record<string, boolean>>({});
    const [tests, setTests] = useState<string[]>([]);
    const [testPick, setTestPick] = useState("");
    const [requestedLabTests, setRequestedLabTests] = useState<string[]>([]);
    const [requestingLabTest, setRequestingLabTest] = useState(false);
    const [meds, setMeds] = useState<{ medicationName: string; dosage: string; frequency: string; duration: string; instructions: string }[]>([]);
    const [med, setMed] = useState({ medicationName: "", dosage: "", frequency: "Once Daily", duration: "", instructions: "" });
    const [saving, setSaving] = useState(false);

    // Prescription stays locked as soon as any lab test is in play for this
    // consultation — whether already persisted (visitLabRequests) or just
    // staged locally (tests) — and only unlocks once labs are back and reviewed.
    const hasAnyLabRequest = visitLabRequests.length > 0 || tests.length > 0;
    const canPrescribe = !hasAnyLabRequest || (isPostLabPhase && hasCompletedLabResults);

    // Sync the form from the saved consultation whenever the underlying doc
    // changes (keyed on the stable id, not the object — Firestore snapshots
    // produce a new object identity every tick even when nothing changed).
    useEffect(() => {
      setForm(existingConsultation
        ? {
          presenting_complaint: existingConsultation.presenting_complaint ?? "",
          history_of_presenting_illness: existingConsultation.history_of_presenting_illness ?? "",
          examination_findings: existingConsultation.examination_findings ?? "",
          diagnosis: existingConsultation.diagnosis ?? "",
          treatment_plan: existingConsultation.treatment_plan ?? "",
        }
        : { presenting_complaint: "", history_of_presenting_illness: "", examination_findings: "", diagnosis: "", treatment_plan: "" });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingConsultation?.id, visitId]);

    if (!visit || !patient) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Select an active consultation:</p>
          <select value={visitId} onChange={(e) => { setVisitId(e.target.value); setActiveVisitId(e.target.value); }} className={inputCls()}>
            <option value="">— Select —</option>
            {reviewableVisits.map((v) => { const p = patients.find((x) => x.id === v.patient_id); return p ? <option key={v.id} value={v.id}>{p.patient_code} — {p.first_name} {p.last_name}</option> : null; })}
          </select>
        </div>
      );
    }

    const requestLabTest = async () => {
      if (!testPick) {
        toast.error("Select a lab test first");
        return;
      }
      if (!serviceCleared) {
        toast.error("Lab requests remain locked until payment is cleared or insurance is validated.");
        return;
      }
      const alreadyRequested = labRequests.some((request) => request.visit_id === visit.id && request.test_type === testPick && isLabRequestPending(request));
      if (alreadyRequested) {
        toast.error(`${testPick} is already queued for this visit`);
        return;
      }
      setRequestingLabTest(true);
      try {
        const lab_code = await nextCode("LAB", "lab_requests");
        const requestRef = doc(collection(db, "lab_requests"));
        const now = new Date().toISOString();
        const batch = writeBatch(db);
        batch.set(requestRef, {
          lab_code,
          patient_id: patient.id,
          visit_id: visit.id,
          consultation_id: existingConsultation?.id ?? null,
          test_type: testPick,
          status: "Pending",
          lab_status: "pending",
          results_received: false,
          result_details: null,
          result_status: null,
          requested_by: staff!.staff_id,
          requested_at: now,
        });
        await stageLabPaymentStub(batch, { payments, visitId: visit.id, patientId: patient.id, labRequestIds: [requestRef.id], staffId: staff!.staff_id });
        batch.update(doc(db, "visits", visit.id), { status: "Waiting for Lab Payment" });
        await batch.commit();
        setTests((prev) => (prev.includes(testPick) ? prev : [...prev, testPick]));
        setRequestedLabTests((prev) => (prev.includes(testPick) ? prev : [...prev, testPick]));
        setTestPick("");
        toast.success(`${testPick} sent to the lab queue — payment routed to Receptionist`);
      } catch (err: unknown) {
        toast.error((err as Error).message ?? "Lab request failed");
      } finally {
        setRequestingLabTest(false);
      }
    };

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      const required = ["presenting_complaint","diagnosis","treatment_plan"] as const;
      const next: Record<string, boolean> = {};
      required.forEach((k) => { if (!form[k]) next[k] = true; });
      setErrs(next);
      if (Object.keys(next).length) { toast.error("Fill required fields"); return; }
      if (!serviceCleared) { toast.error("Payment must be cleared before consultation."); return; }
      setSaving(true);
      try {
        const batch = writeBatch(db);
        const now = new Date().toISOString();
        const consRef = existingConsultation ? doc(db, "consultations", existingConsultation.id) : doc(collection(db, "consultations"));

        batch.set(consRef, {
          ...form,
          patient_id: patient.id,
          visit_id: visit.id,
          ...(existingConsultation ? {} : { consulted_by: staff!.staff_id, consulted_at: now }),
          updated_by: staff!.staff_id,
          updated_at: now,
        }, { merge: true });

        const inventoryAdjustments = new Map<string, number>();

        const pendingLabTestsToSave = tests.filter((test) => !requestedLabTests.includes(test));
        const newLabRequestIds: string[] = [];
        if (pendingLabTestsToSave.length) {
          for (const t of pendingLabTestsToSave) {
            const lab_code = await nextCode("LAB", "lab_requests");
            const labRef = doc(collection(db, "lab_requests"));
            batch.set(labRef, {
              lab_code,
              patient_id: patient.id,
              visit_id: visit.id,
              consultation_id: consRef.id,
              test_type: t,
              status: "Pending",
              lab_status: "pending",
              results_received: false,
              result_details: null,
              result_status: null,
              requested_by: staff!.staff_id,
              requested_at: now,
            });
            newLabRequestIds.push(labRef.id);
          }
          await stageLabPaymentStub(batch, { payments, visitId: visit.id, patientId: patient.id, labRequestIds: newLabRequestIds, staffId: staff!.staff_id });
        }

        const orphanLabRequests = labRequests.filter((r) => r.visit_id === visit.id && !r.consultation_id);
        for (const request of orphanLabRequests) {
          batch.update(doc(db, "lab_requests", request.id), { consultation_id: consRef.id });
        }

        if (meds.length && canPrescribe) {
          const rx_code = await nextCode("RX", "prescriptions");
          const rxRef = doc(collection(db, "prescriptions"));
          batch.set(rxRef, {
            rx_code,
            patient_id: patient.id,
            visit_id: visit.id,
            consultation_id: consRef.id,
            medications: meds,
            issued_by: staff!.staff_id,
            issued_at: now,
            dispensed: false,
            dispensed_by: null,
            dispensed_at: null,
            notes: null,
          });
          for (const medLine of meds) {
            const item = matchInventoryItem(medLine.medicationName, inventory);
            if (!item) continue;
            inventoryAdjustments.set(item.id, (inventoryAdjustments.get(item.id) ?? 0) + 1);
          }
          for (const [itemId, qty] of inventoryAdjustments.entries()) {
            const item = inventory.find((x) => x.id === itemId);
            if (!item) continue;
            const nextStock = Math.max(0, item.stock_level - qty);
            batch.update(doc(db, "inventory", itemId), { stock_level: nextStock, status: nextStock <= 0 ? "Out of Stock" : nextStock <= item.reorder_level ? "Low Stock" : "In Stock" });
          }
        }

        const sendingNewLabTests = pendingLabTestsToSave.length > 0;
        const nextStatus = sendingNewLabTests ? "Waiting for Lab Payment" : "Waiting for Pharmacy";
        const visitUpdate: Record<string, unknown> = { status: nextStatus };
        if (isPostLabPhase) visitUpdate.lab_returned_at = null;
        batch.update(doc(db, "visits", visit.id), visitUpdate);
        await batch.commit();
        setSaving(false);
        toast.success(isPostLabPhase ? `Consultation updated. Patient → ${nextStatus}` : `Consultation saved. Patient → ${nextStatus}`);
        setActiveVisitId(null); setVisitId("");
        setForm({ presenting_complaint: "", history_of_presenting_illness: "", examination_findings: "", diagnosis: "", treatment_plan: "" });
        setTests([]); setMeds([]);
        setTab("queue");
      } catch (err: unknown) {
        setSaving(false);
        toast.error((err as Error).message ?? "Save failed");
      }
    };

    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-semibold">Patient Information</div>
            <div><span className="font-mono">{patient.patient_code}</span> — {patient.first_name} {patient.last_name}</div>
            <div>Age {ageFromDob(patient.date_of_birth)} · {patient.gender}</div>
            <div>Insurance: {patient.insurance_number ?? "—"}</div>
            <div>Payment: <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(payment?.status ?? "Pending")}`}>{paymentLabel(payment)}</span></div>
            <div>Method: <span className={`rounded px-2 py-0.5 text-xs ${serviceCleared ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{payment?.method ?? "Unknown"}</span></div>
            <div>Service gate: <span className={`rounded px-2 py-0.5 text-xs ${serviceCleared ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{serviceCleared ? "Cleared" : "Blocked"}</span></div>
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-semibold">Triage Vitals</div>
            {triage ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div>BP: {triage.bp_systolic}/{triage.bp_diastolic}</div>
                <div>Temp: {triage.temperature}°C</div>
                <div>Pulse: {triage.pulse}</div>
                <div>SpO₂: {triage.oxygen_saturation}%</div>
                <div>Weight: {triage.weight} kg</div>
                <div>Height: {triage.height} cm</div>
                <div>BMI: {triage.bmi}</div>
                <div>Priority: <span className={`rounded border px-1.5 py-0.5 text-xs ${priorityBadge(triage.priority)}`}>{triage.priority}</span></div>
                <div className="col-span-2 mt-1">Chief Complaint: {triage.chief_complaint}</div>
              </div>
            ) : <div className="text-muted-foreground">No triage record</div>}
          </div>
        </div>

        {isPostLabPhase ? (
          <div className="space-y-3 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-semibold">Lab Review</div>
            <div className="space-y-2">
              {visitLabResults.length ? visitLabResults.map((r) => {
                const req = visitLabRequests.find((x) => x.id === r.lab_request_id);
                return <div key={r.id} className="rounded bg-white p-2 text-xs text-slate-700">{req?.test_type}: {r.result_status} - {r.result_details}</div>;
              }) : <div className="text-xs text-emerald-800">No lab results found yet.</div>}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Presenting Complaint" required><textarea rows={3} className={inputCls(errs.presenting_complaint)} value={form.presenting_complaint} onChange={(e) => setForm({ ...form, presenting_complaint: e.target.value })} /></Field>
          <Field label="History of Presenting Illness"><textarea rows={3} className={inputCls()} value={form.history_of_presenting_illness} onChange={(e) => setForm({ ...form, history_of_presenting_illness: e.target.value })} /></Field>
          <Field label="Examination Findings"><textarea rows={3} className={inputCls()} value={form.examination_findings} onChange={(e) => setForm({ ...form, examination_findings: e.target.value })} /></Field>
          <Field label="Diagnosis" required><textarea rows={3} className={inputCls(errs.diagnosis)} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Treatment Plan" required><textarea rows={3} className={inputCls(errs.treatment_plan)} value={form.treatment_plan} onChange={(e) => setForm({ ...form, treatment_plan: e.target.value })} /></Field></div>
        </div>

        {!isPostLabPhase ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 font-semibold text-sm">Laboratory Requests</div>
            {!serviceCleared ? <p className="mb-2 text-xs text-amber-700">Lab requests remain locked until payment is cleared or insurance is validated.</p> : null}
            <div className="flex flex-wrap gap-2">
              <select className={inputCls()} value={testPick} onChange={(e) => setTestPick(e.target.value)}>
                <option value="">Select test…</option>
                {LAB_TESTS.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button type="button" disabled={!serviceCleared} onClick={() => { if (testPick) { setTests((p) => (p.includes(testPick) ? p : [...p, testPick])); setTestPick(""); } }} className="flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"><Plus className="size-4" /> Add to Consultation</button>
              <button type="button" disabled={!serviceCleared || !testPick || requestingLabTest} onClick={requestLabTest} className="flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-50">{requestingLabTest ? <Spinner /> : null} Request Lab Test</button>
            </div>
            <ul className="mt-2 space-y-1">
              {tests.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-sm"><span>{t}</span><button type="button" onClick={() => setTests(tests.filter((_, j) => j !== i))} className="text-rose-600"><X className="size-4" /></button></li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 font-semibold text-sm">Prescription</div>
          {!canPrescribe ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Prescription entry is locked until lab results are received and reviewed.</div>
          ) : hasAnyLabRequest ? (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">Lab results are available, so prescription entry is unlocked.</div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-5">
            <input placeholder="Medication" disabled={!canPrescribe} className={inputCls()} value={med.medicationName} onChange={(e) => setMed({ ...med, medicationName: e.target.value })} />
            <input placeholder="Dosage" disabled={!canPrescribe} className={inputCls()} value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })} />
            <select disabled={!canPrescribe} className={inputCls()} value={med.frequency} onChange={(e) => setMed({ ...med, frequency: e.target.value })}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select>
            <input placeholder="Duration" disabled={!canPrescribe} className={inputCls()} value={med.duration} onChange={(e) => setMed({ ...med, duration: e.target.value })} />
            <input placeholder="Instructions" disabled={!canPrescribe} className={inputCls()} value={med.instructions} onChange={(e) => setMed({ ...med, instructions: e.target.value })} />
          </div>
          <button type="button" disabled={!canPrescribe} onClick={() => { if (med.medicationName && med.dosage) { setMeds((p) => [...p, med]); setMed({ medicationName: "", dosage: "", frequency: "Once Daily", duration: "", instructions: "" }); } }} className="mt-2 flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-60"><Plus className="size-4" /> Add Medication</button>
          <ul className="mt-2 space-y-1">
            {meds.map((m, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-sm"><span>{m.medicationName} — {m.dosage}, {m.frequency}, {m.duration}</span><button type="button" onClick={() => setMeds(meds.filter((_, j) => j !== i))} className="text-rose-600"><X className="size-4" /></button></li>
            ))}
          </ul>
        </div>

        <button disabled={saving} className="flex items-center gap-2 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60">{saving ? <Spinner /> : null} {isPostLabPhase ? "Save Prescription Review" : "Save Consultation"}</button>
      </form>
    );
  }

  function ResultsTab() {
    const reqIds = useMemo(() => new Set(labRequests.filter((r) => r.requested_by === staff?.staff_id).map((r) => r.id)), [labRequests, staff?.staff_id]);
    const rows = labResults.filter((r) => reqIds.has(r.lab_request_id)).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    if (!rows.length) return <Empty />;
    return (
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Test</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Uploaded</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const p = patients.find((x) => x.id === r.patient_id);
            const req = labRequests.find((x) => x.id === r.lab_request_id);
            return (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{p ? `${p.first_name} ${p.last_name}` : "—"}</td>
                <td className="px-3 py-2">{req?.test_type}</td>
                <td className="px-3 py-2">{r.result_details}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${statusBadge(r.result_status)}`}>{r.result_status}</span></td>
                <td className="px-3 py-2">{new Date(r.uploaded_at).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function PrescriptionsTab() {
    const rows = prescriptions.filter((p) => p.issued_by === staff?.staff_id && isToday(p.issued_at));
    if (!rows.length) return <Empty />;
    return (
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">RX</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Medications</th><th className="px-3 py-2">Dispensed</th><th className="px-3 py-2">Issued</th></tr></thead>
        <tbody>
          {rows.map((p) => {
            const pat = patients.find((x) => x.id === p.patient_id);
            return (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.rx_code}</td>
                <td className="px-3 py-2">{pat ? `${pat.first_name} ${pat.last_name}` : "—"}</td>
                <td className="px-3 py-2">{p.medications.map((m) => m.medicationName).join(", ")}</td>
                <td className="px-3 py-2">{p.dispensed ? "Yes" : "No"}</td>
                <td className="px-3 py-2">{new Date(p.issued_at).toLocaleTimeString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
}
