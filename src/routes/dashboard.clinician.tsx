import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { collection, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildDailyReportSummary, canProceedToService, matchInventoryItem, nextCode } from "@/lib/firestore-helpers";
import { useAuth } from "@/context/AuthContext";
import { usePatientData, type Payment } from "@/context/PatientDataContext";
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

function Dashboard() {
  const { staff } = useAuth();
  const { patients, visits, triageRecords, payments, consultations, labRequests, labResults, prescriptions, inventory } = usePatientData();
  const { toast, ui } = useToast();
  const [tab, setTab] = useState<Tab>("queue");
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);

  const queue = useMemo(() => visits.filter((v) => {
    if (v.status !== "Waiting for Consultation") return false;
    const patient = patients.find((p) => p.id === v.patient_id);
    const payment = payments.find((p) => p.visit_id === v.id);
    return canProceedToService(payment, patient?.insurance_number);
  }), [patients, payments, visits]);
  const consultationsToday = consultations.filter((c) => isToday(c.consulted_at) && c.consulted_by === staff?.staff_id).length;
  const pendingLab = labRequests.filter((r) => r.status !== "Completed" && r.requested_by === staff?.staff_id).length;

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
          <StatCard label="Consultations Today" value={consultationsToday} tone="ok" />
          <StatCard label="Pending Lab Results" value={pendingLab} />
        </div>
        <div className="flex justify-end">
          <button onClick={downloadDailyReport} className="flex items-center gap-2 rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="size-4" /> Download Daily Report
          </button>
        </div>
        <Tabs accent="bg-violet-600" current={tab} onChange={(id) => setTab(id as Tab)} tabs={[{ id: "queue", label: "Patient Queue" }, { id: "consultation", label: "Consultation" }, { id: "results", label: "Lab Results" }, { id: "prescriptions", label: "Prescriptions Issued" }]} />
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
    const payment = visit ? payments.find((p) => p.visit_id === visit.id) : null;
    const existingConsultation = visit ? consultations.find((c) => c.visit_id === visit.id) : null;
    const serviceCleared = canProceedToService(payment, patient?.insurance_number);
    const visitLabRequests = visit ? labRequests.filter((r) => r.visit_id === visit.id) : [];
    const visitLabResults = useMemo(() => {
      const reqIds = new Set(visitLabRequests.map((r) => r.id));
      return labResults.filter((r) => reqIds.has(r.lab_request_id));
    }, [labResults, visitLabRequests]);
    const reviewMode = !!(visit?.lab_returned_at && existingConsultation);

    const [form, setForm] = useState({ presenting_complaint: "", history_of_presenting_illness: "", examination_findings: "", diagnosis: "", treatment_plan: "" });
    const [errs, setErrs] = useState<Record<string, boolean>>({});
    const [tests, setTests] = useState<string[]>([]);
    const [testPick, setTestPick] = useState("");
    const [meds, setMeds] = useState<{ medicationName: string; dosage: string; frequency: string; duration: string; instructions: string }[]>([]);
    const [med, setMed] = useState({ medicationName: "", dosage: "", frequency: "Once Daily", duration: "", instructions: "" });
    const [saving, setSaving] = useState(false);

    const inConsultation = visits.filter((v) => v.status === "In Consultation");

    if (!visit || !patient) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Select an active consultation:</p>
          <select value={visitId} onChange={(e) => { setVisitId(e.target.value); setActiveVisitId(e.target.value); }} className={inputCls()}>
            <option value="">— Select —</option>
            {inConsultation.map((v) => { const p = patients.find((x) => x.id === v.patient_id); return p ? <option key={v.id} value={v.id}>{p.patient_code} — {p.first_name} {p.last_name}</option> : null; })}
          </select>
        </div>
      );
    }

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      const required = reviewMode ? [] : ["presenting_complaint","diagnosis","treatment_plan"] as const;
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

        if (!reviewMode && !existingConsultation) {
          batch.set(consRef, {
            ...form,
            patient_id: patient.id,
            visit_id: visit.id,
            consulted_by: staff!.staff_id,
            consulted_at: now,
          });
        }

        const inventoryAdjustments = new Map<string, number>();

        if (!reviewMode && tests.length) {
          for (const t of tests) {
            const lab_code = await nextCode("LAB", "lab_requests");
            const labRef = doc(collection(db, "lab_requests"));
            batch.set(labRef, {
              lab_code,
              patient_id: patient.id,
              visit_id: visit.id,
              consultation_id: consRef.id,
              test_type: t,
              status: "Pending",
              requested_by: staff!.staff_id,
              requested_at: now,
            });
          }
        }

        if ((reviewMode || tests.length === 0) && meds.length) {
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

        const nextStatus = reviewMode ? "Waiting for Pharmacy" : tests.length ? "In Lab" : "Waiting for Pharmacy";
        batch.update(doc(db, "visits", visit.id), reviewMode ? { status: nextStatus, lab_returned_at: null } : { status: nextStatus });
        await batch.commit();
        setSaving(false);
        toast.success(reviewMode ? `Prescription saved. Patient → ${nextStatus}` : `Consultation saved. Patient → ${nextStatus}`);
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

        {reviewMode ? (
          <div className="space-y-3 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-semibold">Lab Review</div>
            <div>Previous consult: {existingConsultation?.diagnosis ?? "—"}</div>
            <div className="space-y-2">
              {visitLabResults.length ? visitLabResults.map((r) => {
                const req = visitLabRequests.find((x) => x.id === r.lab_request_id);
                return <div key={r.id} className="rounded bg-white p-2 text-xs text-slate-700">{req?.test_type}: {r.result_status} - {r.result_details}</div>;
              }) : <div className="text-xs text-emerald-800">No lab results found yet.</div>}
            </div>
          </div>
        ) : null}

        {!reviewMode ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Presenting Complaint" required><textarea rows={3} className={inputCls(errs.presenting_complaint)} value={form.presenting_complaint} onChange={(e) => setForm({ ...form, presenting_complaint: e.target.value })} /></Field>
            <Field label="History of Presenting Illness"><textarea rows={3} className={inputCls()} value={form.history_of_presenting_illness} onChange={(e) => setForm({ ...form, history_of_presenting_illness: e.target.value })} /></Field>
            <Field label="Examination Findings"><textarea rows={3} className={inputCls()} value={form.examination_findings} onChange={(e) => setForm({ ...form, examination_findings: e.target.value })} /></Field>
            <Field label="Diagnosis" required><textarea rows={3} className={inputCls(errs.diagnosis)} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Treatment Plan" required><textarea rows={3} className={inputCls(errs.treatment_plan)} value={form.treatment_plan} onChange={(e) => setForm({ ...form, treatment_plan: e.target.value })} /></Field></div>
          </div>
        ) : null}

        {!reviewMode ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 font-semibold text-sm">Laboratory Requests</div>
            {!serviceCleared ? <p className="mb-2 text-xs text-amber-700">Lab requests remain locked until payment is cleared or insurance is validated.</p> : null}
            <div className="flex gap-2">
              <select className={inputCls()} value={testPick} onChange={(e) => setTestPick(e.target.value)}>
                <option value="">Select test…</option>
                {LAB_TESTS.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button type="button" disabled={!serviceCleared} onClick={() => { if (testPick) { setTests((p) => [...p, testPick]); setTestPick(""); } }} className="flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"><Plus className="size-4" /> Add</button>
            </div>
            <ul className="mt-2 space-y-1">
              {tests.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-sm"><span>{t}</span><button type="button" onClick={() => setTests(tests.filter((_, j) => j !== i))} className="text-rose-600"><X className="size-4" /></button></li>
              ))}
            </ul>
          </div>
        ) : null}

        {reviewMode || tests.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 font-semibold text-sm">Prescription</div>
            <div className="grid gap-2 sm:grid-cols-5">
              <input placeholder="Medication" className={inputCls()} value={med.medicationName} onChange={(e) => setMed({ ...med, medicationName: e.target.value })} />
              <input placeholder="Dosage" className={inputCls()} value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })} />
              <select className={inputCls()} value={med.frequency} onChange={(e) => setMed({ ...med, frequency: e.target.value })}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select>
              <input placeholder="Duration" className={inputCls()} value={med.duration} onChange={(e) => setMed({ ...med, duration: e.target.value })} />
              <input placeholder="Instructions" className={inputCls()} value={med.instructions} onChange={(e) => setMed({ ...med, instructions: e.target.value })} />
            </div>
            <button type="button" onClick={() => { if (med.medicationName && med.dosage) { setMeds((p) => [...p, med]); setMed({ medicationName: "", dosage: "", frequency: "Once Daily", duration: "", instructions: "" }); } }} className="mt-2 flex items-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700"><Plus className="size-4" /> Add Medication</button>
            <ul className="mt-2 space-y-1">
              {meds.map((m, i) => (
                <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-sm"><span>{m.medicationName} — {m.dosage}, {m.frequency}, {m.duration}</span><button type="button" onClick={() => setMeds(meds.filter((_, j) => j !== i))} className="text-rose-600"><X className="size-4" /></button></li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">Prescription entry is deferred until lab results are reviewed.</div>
        )}

        <button disabled={saving} className="flex items-center gap-2 rounded-md bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60">{saving ? <Spinner /> : null} {reviewMode ? "Save Prescription Review" : "Save Consultation"}</button>
      </form>
    );
  }

  function ResultsTab() {
    const myConsultIds = useMemo(() => new Set(consultations.filter((c) => c.consulted_by === staff?.staff_id).map((c) => c.id)), []);
    const reqIds = useMemo(() => new Set(labRequests.filter((r) => r.consultation_id && myConsultIds.has(r.consultation_id)).map((r) => r.id)), [myConsultIds]);
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
