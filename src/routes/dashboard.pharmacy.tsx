import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { canProceedToService, purposePaymentByVisit, recomputeInventoryStatus, stagePharmacyPaymentStub } from "@/lib/firestore-helpers";
import { useAuth } from "@/context/AuthContext";
import { usePatientData } from "@/context/PatientDataContext";
import { RoleGuard, RoleHeader, FlowTracker, StatCard, Tabs, Empty, Spinner, Field, inputCls, useToast, isToday, statusBadge } from "@/components/his/shared";
import { paymentLabel } from "./dashboard.clinician";

export const Route = createFileRoute("/dashboard/pharmacy")({ component: () => <RoleGuard role="Pharmacist"><Dashboard /></RoleGuard> });

type Tab = "queue" | "dispense" | "inventory" | "history";

function Dashboard() {
  const { staff } = useAuth();
  const { patients, prescriptions, consultations, payments, inventory } = usePatientData();
  const { toast, ui } = useToast();
  const [tab, setTab] = useState<Tab>("queue");
  const [activeRx, setActiveRx] = useState<string | null>(null);

  const pending = prescriptions.filter((p) => !p.dispensed);
  const dispensedToday = prescriptions.filter((p) => p.dispensed && p.dispensed_at && isToday(p.dispensed_at));
  const lowAlerts = inventory.filter((i) => i.status === "Low Stock" || i.status === "Out of Stock").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <RoleHeader title="Pharmacist Dashboard" accent="bg-teal-600" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <FlowTracker />
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Pending Prescriptions" value={pending.length} tone="warn" />
          <StatCard label="Dispensed Today" value={dispensedToday.length} tone="ok" />
          <StatCard label="Low Stock Alerts" value={lowAlerts} tone={lowAlerts > 0 ? "danger" : "default"} />
        </div>
        <Tabs accent="bg-teal-600" current={tab} onChange={(id) => setTab(id as Tab)} tabs={[{ id: "queue", label: "Prescription Queue" }, { id: "dispense", label: "Dispense Medication" }, { id: "inventory", label: "Inventory" }, { id: "history", label: "Dispensing History" }]} />
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {tab === "queue" ? (
            !pending.length ? <Empty /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">RX</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Medications</th><th className="px-3 py-2">Issued By</th><th className="px-3 py-2">Time</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {pending.map((rx) => {
                    const p = patients.find((x) => x.id === rx.patient_id);
                    return (
                      <tr key={rx.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{rx.rx_code}</td>
                        <td className="px-3 py-2">{p ? `${p.first_name} ${p.last_name}` : "—"}</td>
                        <td className="px-3 py-2">{rx.medications.map((m) => m.medicationName).join(", ")}</td>
                        <td className="px-3 py-2">{rx.issued_by}</td>
                        <td className="px-3 py-2">{new Date(rx.issued_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2"><button onClick={() => { setActiveRx(rx.id); setTab("dispense"); }} className="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700">Dispense</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}
          {tab === "dispense" ? <DispenseForm /> : null}
          {tab === "inventory" ? <InventoryTab /> : null}
          {tab === "history" ? <HistoryTab /> : null}
        </div>
      </div>
      {ui}
    </div>
  );

  function DispenseForm() {
    const [rxId, setRxId] = useState(activeRx ?? "");
    const rx = prescriptions.find((r) => r.id === rxId);
    const patient = rx ? patients.find((p) => p.id === rx.patient_id) : null;
    const cons = rx ? consultations.find((c) => c.id === rx.consultation_id) : null;
    const pay = rx ? purposePaymentByVisit(payments, rx.visit_id, "Registration") : null;
    const serviceCleared = canProceedToService(pay, patient?.insurance_number);
    const [checks, setChecks] = useState<Record<number, { dispensed: boolean; qty: string; subst: string }>>({});
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    if (!rx || !patient) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Pick a pending prescription:</p>
          <select className={inputCls()} value={rxId} onChange={(e) => { setRxId(e.target.value); setActiveRx(e.target.value); }}>
            <option value="">— Select —</option>
            {pending.map((r) => <option key={r.id} value={r.id}>{r.rx_code}</option>)}
          </select>
        </div>
      );
    }

    const submit = async () => {
      if (!serviceCleared) {
        toast.error("Payment must be cleared before dispensing.");
        return;
      }
      setSaving(true);
      try {
        const now = new Date().toISOString();
        const batch = writeBatch(db);
        batch.update(doc(db, "prescriptions", rx.id), {
          dispensed: true,
          dispensed_by: staff!.staff_id,
          dispensed_at: now,
          notes: notes || null,
        });
        await stagePharmacyPaymentStub(batch, { payments, visitId: rx.visit_id, patientId: patient.id, prescriptionIds: [rx.id], staffId: staff!.staff_id });
        batch.update(doc(db, "visits", rx.visit_id), { status: "Waiting for Pharmacy Payment" });
        await batch.commit();
        setSaving(false);
        toast.success("Prescription dispensed. Medication fee routed to Receptionist for billing.");
        setActiveRx(null); setRxId(""); setChecks({}); setNotes("");
        setTab("queue");
      } catch (err: unknown) {
        setSaving(false);
        toast.error((err as Error).message ?? "Dispense failed");
      }
    };

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-semibold">Patient</div>
            <div>{patient.first_name} {patient.last_name} · <span className="font-mono">{patient.patient_code}</span></div>
            <div>Diagnosis: {cons?.diagnosis ?? "—"}</div>
            <div>Payment: <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(pay?.status ?? "Pending")}`}>{paymentLabel(pay)}</span></div>
            <div>Service gate: <span className={`rounded px-2 py-0.5 text-xs ${serviceCleared ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{serviceCleared ? "Cleared" : "Blocked"}</span></div>
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-semibold">Prescription</div>
            <div className="font-mono text-xs">{rx.rx_code}</div>
            <div>Issued by {rx.issued_by} at {new Date(rx.issued_at).toLocaleTimeString()}</div>
          </div>
        </div>
        <div className="space-y-2">
          {rx.medications.map((m, i) => {
            const c = checks[i] ?? { dispensed: false, qty: "", subst: "" };
            const inv = inventory.find((x) => x.medication_name.toLowerCase() === m.medicationName.toLowerCase());
            return (
              <div key={i} className="rounded-md border bg-white p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={c.dispensed} onChange={(e) => setChecks({ ...checks, [i]: { ...c, dispensed: e.target.checked } })} />
                  {m.medicationName} — {m.dosage} · {m.frequency} · {m.duration}
                </label>
                <div className="mt-1 text-xs text-muted-foreground">Instructions: {m.instructions || "—"} · Stock: {inv?.stock_level ?? "N/A"}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input placeholder="Quantity dispensed" type="number" className={inputCls()} value={c.qty} onChange={(e) => setChecks({ ...checks, [i]: { ...c, qty: e.target.value } })} />
                  <input placeholder="Substitution (optional)" className={inputCls()} value={c.subst} onChange={(e) => setChecks({ ...checks, [i]: { ...c, subst: e.target.value } })} />
                </div>
              </div>
            );
          })}
        </div>
        <Field label="Dispensing Notes"><textarea rows={2} className={inputCls()} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <button disabled={saving || !serviceCleared} onClick={submit} className="flex items-center gap-2 rounded-md bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">{saving ? <Spinner /> : null} Confirm Dispensing</button>
      </div>
    );
  }

  function InventoryTab() {
    const [addFor, setAddFor] = useState<string | null>(null);
    const [qty, setQty] = useState("");
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Medication</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Reorder Level</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {inventory.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2">{i.medication_name}</td>
                <td className="px-3 py-2">{i.category}</td>
                <td className="px-3 py-2">{i.stock_level}</td>
                <td className="px-3 py-2">{i.unit}</td>
                <td className="px-3 py-2">{i.reorder_level}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${statusBadge(i.status)}`}>{i.status}</span></td>
                <td className="px-3 py-2">
                  {addFor === i.id ? (
                    <div className="flex gap-1">
                      <input type="number" placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 rounded border px-2 py-1 text-sm" />
                      <button onClick={async () => {
                        const add = Number(qty || 0); if (!add) return;
                        const newStock = i.stock_level + add;
                        await updateDoc(doc(db, "inventory", i.id), {
                          stock_level: newStock,
                          status: recomputeInventoryStatus(newStock, i.reorder_level),
                        });
                        toast.success(`Added ${add} to ${i.medication_name}`);
                        setAddFor(null); setQty("");
                      }} className="rounded bg-teal-600 px-2 py-1 text-xs text-white">Save</button>
                      <button onClick={() => { setAddFor(null); setQty(""); }} className="rounded border px-2 py-1 text-xs">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddFor(i.id)} className="rounded-md bg-teal-600 px-3 py-1 text-xs text-white hover:bg-teal-700">Add Stock</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function HistoryTab() {
    if (!dispensedToday.length) return <Empty />;
    return (
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">RX</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Medications</th><th className="px-3 py-2">Dispensed By</th><th className="px-3 py-2">Time</th></tr></thead>
        <tbody>
          {dispensedToday.map((rx) => {
            const p = patients.find((x) => x.id === rx.patient_id);
            return (
              <tr key={rx.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{rx.rx_code}</td>
                <td className="px-3 py-2">{p ? `${p.first_name} ${p.last_name}` : "—"}</td>
                <td className="px-3 py-2">{rx.medications.map((m) => m.medicationName).join(", ")}</td>
                <td className="px-3 py-2">{rx.dispensed_by}</td>
                <td className="px-3 py-2">{rx.dispensed_at ? new Date(rx.dispensed_at).toLocaleTimeString() : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
}
