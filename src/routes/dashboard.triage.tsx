import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePatientData } from "@/context/PatientDataContext";
import { canProceedToService } from "@/lib/firestore-helpers";
import { RoleGuard, RoleHeader, FlowTracker, StatCard, Tabs, Empty, Spinner, Field, inputCls, useToast, isToday, ageFromDob } from "@/components/his/shared";

export const Route = createFileRoute("/dashboard/triage")({ component: () => <RoleGuard role="TriageNurse"><Dashboard /></RoleGuard> });

type Tab = "queue" | "vitals" | "history";

function bmiCategory(bmi: number) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

function Dashboard() {
  const { staff } = useAuth();
  const { patients, visits, payments, triageRecords } = usePatientData();
  const { toast, ui } = useToast();
  const [tab, setTab] = useState<Tab>("queue");
  const [active, setActive] = useState<{ patientId: string; visitId: string } | null>(null);

  const queue = useMemo(() => visits.filter((v) => {
    if (v.status !== "Waiting for Triage") return false;
    const patient = patients.find((p) => p.id === v.patient_id);
    const payment = payments.find((p) => p.visit_id === v.id);
    return canProceedToService(payment, patient?.insurance_number);
  }), [patients, payments, visits]);
  const completedToday = triageRecords.filter((t) => isToday(t.recorded_at)).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <RoleHeader title="Triage Nurse Dashboard" accent="bg-emerald-600" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <FlowTracker />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Waiting for Triage" value={queue.length} tone="warn" />
          <StatCard label="Completed Triage Today" value={completedToday} tone="ok" />
        </div>
        <Tabs accent="bg-emerald-600" current={tab} onChange={(id) => setTab(id as Tab)} tabs={[{ id: "queue", label: "Patient Queue" }, { id: "vitals", label: "Record Vitals" }, { id: "history", label: "Triage History" }]} />
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {tab === "queue" ? (
            !queue.length ? <Empty /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Time</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {queue.map((v) => {
                    const p = patients.find((x) => x.id === v.patient_id);
                    if (!p) return null;
                    return (
                      <tr key={v.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{p.patient_code}</td>
                        <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                        <td className="px-3 py-2">{ageFromDob(p.date_of_birth)}</td>
                        <td className="px-3 py-2">{p.visit_reason}</td>
                        <td className="px-3 py-2">{new Date(v.visit_date).toLocaleTimeString()}</td>
                        <td className="px-3 py-2"><button onClick={() => {
                          const payment = payments.find((py) => py.visit_id === v.id);
                          if (!canProceedToService(payment, p.insurance_number)) {
                            toast.error("Payment must be cleared before triage.");
                            return;
                          }
                          setActive({ patientId: p.id, visitId: v.id });
                          setTab("vitals");
                        }} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">Start Triage</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}
          {tab === "vitals" ? <VitalsForm /> : null}
          {tab === "history" ? <HistoryTab /> : null}
        </div>
      </div>
      {ui}
    </div>
  );

  function VitalsForm() {
    const [pickerVisit, setPickerVisit] = useState("");
    const current = active ?? (pickerVisit ? (() => { const v = visits.find((x) => x.id === pickerVisit); return v ? { patientId: v.patient_id, visitId: v.id } : null; })() : null);
    const patient = current ? patients.find((p) => p.id === current.patientId) : null;
    const [form, setForm] = useState({ bp_systolic: "", bp_diastolic: "", temperature: "", weight: "", height: "", pulse: "", oxygen_saturation: "", blood_sugar: "", chief_complaint: "", priority: "" });
    const [errs, setErrs] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [savedBmi, setSavedBmi] = useState<{ value: number; category: string } | null>(null);

    if (!current || !patient) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Select a patient from the queue to begin triage, or pick from active triage visits below.</p>
          <select value={pickerVisit} onChange={(e) => setPickerVisit(e.target.value)} className={inputCls()}>
            <option value="">— Select waiting patient —</option>
            {queue.map((v) => { const p = patients.find((x) => x.id === v.patient_id); return p ? <option key={v.id} value={v.id}>{p.patient_code} — {p.first_name} {p.last_name}</option> : null; })}
          </select>
        </div>
      );
    }

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      const required = ["bp_systolic","bp_diastolic","temperature","weight","height","pulse","oxygen_saturation","chief_complaint","priority"] as const;
      const next: Record<string, boolean> = {};
      required.forEach((k) => { if (!form[k]) next[k] = true; });
      setErrs(next);
      if (Object.keys(next).length) { toast.error("Please fill required fields"); return; }
      const payment = payments.find((p) => p.visit_id === current.visitId);
      if (!canProceedToService(payment, patient.insurance_number)) {
        toast.error("Payment must be cleared before triage.");
        return;
      }
      const w = Number(form.weight); const hM = Number(form.height) / 100;
      const bmi = +(w / (hM * hM)).toFixed(2);
      setSaving(true);
      try {
        await addDoc(collection(db, "triage_records"), {
          patient_id: current.patientId, visit_id: current.visitId,
          bp_systolic: Number(form.bp_systolic), bp_diastolic: Number(form.bp_diastolic),
          temperature: Number(form.temperature), weight: w, height: Number(form.height), bmi,
          pulse: Number(form.pulse), oxygen_saturation: Number(form.oxygen_saturation),
          blood_sugar: form.blood_sugar ? Number(form.blood_sugar) : null,
          chief_complaint: form.chief_complaint, priority: form.priority,
          recorded_by: staff!.staff_id,
          recorded_at: new Date().toISOString(),
        });
        await updateDoc(doc(db, "visits", current.visitId), { status: "Waiting for Consultation" });
        setSaving(false);
        setSavedBmi({ value: bmi, category: bmiCategory(bmi) });
        toast.success("Triage recorded — patient sent to clinician queue");
        setActive(null);
        setForm({ bp_systolic: "", bp_diastolic: "", temperature: "", weight: "", height: "", pulse: "", oxygen_saturation: "", blood_sugar: "", chief_complaint: "", priority: "" });
      } catch (err: unknown) {
        setSaving(false);
        toast.error((err as Error).message ?? "Save failed");
      }
    };

    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div><b>{patient.first_name} {patient.last_name}</b> — <span className="font-mono">{patient.patient_code}</span></div>
          <div className="text-xs text-muted-foreground">Reason: {patient.visit_reason}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="BP Systolic" required><input type="number" className={inputCls(errs.bp_systolic)} value={form.bp_systolic} onChange={(e) => setForm({ ...form, bp_systolic: e.target.value })} /></Field>
          <Field label="BP Diastolic" required><input type="number" className={inputCls(errs.bp_diastolic)} value={form.bp_diastolic} onChange={(e) => setForm({ ...form, bp_diastolic: e.target.value })} /></Field>
          <Field label="Temperature (°C)" required><input type="number" step="0.1" className={inputCls(errs.temperature)} value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} /></Field>
          <Field label="Weight (kg)" required><input type="number" step="0.1" className={inputCls(errs.weight)} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></Field>
          <Field label="Height (cm)" required><input type="number" step="0.1" className={inputCls(errs.height)} value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} /></Field>
          <Field label="Pulse (bpm)" required><input type="number" className={inputCls(errs.pulse)} value={form.pulse} onChange={(e) => setForm({ ...form, pulse: e.target.value })} /></Field>
          <Field label="Oxygen Saturation (%)" required><input type="number" className={inputCls(errs.oxygen_saturation)} value={form.oxygen_saturation} onChange={(e) => setForm({ ...form, oxygen_saturation: e.target.value })} /></Field>
          <Field label="Blood Sugar (mmol/L)"><input type="number" step="0.1" className={inputCls()} value={form.blood_sugar} onChange={(e) => setForm({ ...form, blood_sugar: e.target.value })} /></Field>
          <Field label="Triage Priority" required>
            <select className={inputCls(errs.priority)} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="">Select…</option><option>Emergency</option><option>Urgent</option><option>Semi-Urgent</option><option>Non-Urgent</option>
            </select>
          </Field>
        </div>
        <Field label="Chief Complaint" required><textarea rows={3} className={inputCls(errs.chief_complaint)} value={form.chief_complaint} onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })} /></Field>
        {savedBmi ? (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Last BMI: <b>{savedBmi.value}</b> — {savedBmi.category}</div>
        ) : null}
        <button disabled={saving} className="flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? <Spinner /> : null} Save Triage</button>
      </form>
    );
  }

  function HistoryTab() {
    const rows = useMemo(() => triageRecords.filter((t) => isToday(t.recorded_at)).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)), []);
    if (!rows.length) return <Empty />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Patient</th><th className="px-3 py-2">BP</th><th className="px-3 py-2">Temp</th><th className="px-3 py-2">Pulse</th><th className="px-3 py-2">SpO₂</th><th className="px-3 py-2">BMI</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Time</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const p = patients.find((x) => x.id === t.patient_id);
              return (
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2">{p ? `${p.first_name} ${p.last_name}` : "—"}</td>
                  <td className="px-3 py-2">{t.bp_systolic}/{t.bp_diastolic}</td>
                  <td className="px-3 py-2">{t.temperature}</td>
                  <td className="px-3 py-2">{t.pulse}</td>
                  <td className="px-3 py-2">{t.oxygen_saturation}%</td>
                  <td className="px-3 py-2">{t.bmi}</td>
                  <td className="px-3 py-2">{t.priority}</td>
                  <td className="px-3 py-2">{new Date(t.recorded_at).toLocaleTimeString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
}
