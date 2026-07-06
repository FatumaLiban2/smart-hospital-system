import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePatientData, type LabRequest } from "@/context/PatientDataContext";
import { RoleGuard, RoleHeader, FlowTracker, StatCard, Tabs, Empty, Spinner, Field, inputCls, useToast, isToday, priorityBadge, statusBadge } from "@/components/his/shared";

export const Route = createFileRoute("/dashboard/lab")({ component: () => <RoleGuard role="LabTechnician"><Dashboard /></RoleGuard> });

type Tab = "queue" | "upload" | "history";

function isLabRequestPending(request: LabRequest) {
  return request.status !== "Completed" && request.status !== "completed" && request.lab_status !== "completed" && !request.results_received;
}

function isLabRequestCompleted(request: LabRequest) {
  return request.status === "Completed" || request.lab_status === "completed" || request.results_received === true;
}

function Dashboard() {
  const { staff } = useAuth();
  const { patients, visits, labRequests, labResults, triageRecords } = usePatientData();
  const { toast, ui } = useToast();
  const [tab, setTab] = useState<Tab>("queue");
  const [activeReq, setActiveReq] = useState<string | null>(null);

  // Only bench requests whose visit has cleared its Lab payment (visit status
  // "In Lab") show up here — mirrors the payment gate every other stage uses.
  const billedVisitIds = useMemo(() => new Set(visits.filter((v) => v.status === "In Lab").map((v) => v.id)), [visits]);
  const pending = labRequests.filter((r) => isLabRequestPending(r) && r.status !== "In Progress" && billedVisitIds.has(r.visit_id));
  const inProgress = labRequests.filter((r) => (r.status === "In Progress" || r.lab_status === "in-progress") && billedVisitIds.has(r.visit_id));
  const pendingRequests = [...pending, ...inProgress];
  const completedToday = labResults.filter((r) => isToday(r.uploaded_at)).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <RoleHeader title="Laboratory Technician Dashboard" accent="bg-orange-600" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <FlowTracker />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Pending Lab Requests" value={pending.length + inProgress.length} tone="warn" />
          <StatCard label="Completed Tests Today" value={completedToday} tone="ok" />
        </div>
        <Tabs accent="bg-orange-600" current={tab} onChange={(id) => setTab(id as Tab)} tabs={[{ id: "queue", label: "Lab Requests" }, { id: "upload", label: "Upload Results" }, { id: "history", label: "Results History" }]} />
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {tab === "queue" ? (
            !pendingRequests.length ? <Empty /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Lab ID</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Test</th><th className="px-3 py-2">Requested By</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {pendingRequests.map((r) => {
                    const p = patients.find((x) => x.id === r.patient_id);
                    const tr = triageRecords.find((t) => t.visit_id === r.visit_id);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{r.lab_code}</td>
                        <td className="px-3 py-2">{p ? `${p.first_name} ${p.last_name}` : "—"}</td>
                        <td className="px-3 py-2">{r.test_type}</td>
                        <td className="px-3 py-2">{r.requested_by}</td>
                        <td className="px-3 py-2"><span className={`rounded border px-2 py-0.5 text-xs ${priorityBadge(tr?.priority)}`}>{tr?.priority ?? "—"}</span></td>
                        <td className="px-3 py-2">{new Date(r.requested_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2">{r.status}</td>
                        <td className="px-3 py-2">
                          <button onClick={async () => {
                            await updateDoc(doc(db, "lab_requests", r.id), { status: "In Progress", lab_status: "in-progress", results_received: false });
                            setActiveReq(r.id); setTab("upload");
                          }} className="rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700">Process Test</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}
          {tab === "upload" ? <UploadForm /> : null}
          {tab === "history" ? <HistoryTab /> : null}
        </div>
      </div>
      {ui}
    </div>
  );

  function UploadForm() {
    const [reqId, setReqId] = useState(activeReq ?? "");
    const req = labRequests.find((r) => r.id === reqId);
    const patient = req ? patients.find((p) => p.id === req.patient_id) : null;
    const [form, setForm] = useState({ result_details: "", reference_range: "", result_status: "", notes: "" });
    const [errs, setErrs] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);

    if (!req || !patient) {
      const choices = labRequests.filter((r) => billedVisitIds.has(r.visit_id) && (r.status === "In Progress" || r.status === "Pending" || r.lab_status === "in-progress" || r.lab_status === "pending" || r.results_received === false));
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Pick a lab request:</p>
          <select className={inputCls()} value={reqId} onChange={(e) => { setReqId(e.target.value); setActiveReq(e.target.value); }}>
            <option value="">— Select —</option>
            {choices.map((r) => <option key={r.id} value={r.id}>{r.lab_code} — {r.test_type}</option>)}
          </select>
        </div>
      );
    }

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      const next: Record<string, boolean> = {};
      if (!form.result_details) next.result_details = true;
      if (!form.result_status) next.result_status = true;
      setErrs(next);
      if (Object.keys(next).length) { toast.error("Fill required fields"); return; }
      setSaving(true);
      try {
        await addDoc(collection(db, "lab_results"), {
          lab_request_id: req.id,
          patient_id: patient.id,
          ...form,
          reference_range: form.reference_range || null,
          notes: form.notes || null,
          uploaded_by: staff!.staff_id,
          uploaded_at: new Date().toISOString(),
        });
        await updateDoc(doc(db, "lab_requests", req.id), {
          status: "Completed",
          lab_status: "completed",
          results_received: true,
          result_details: form.result_details,
          result_status: form.result_status,
        });
        const visitLabRequests = labRequests.filter((r) => r.visit_id === req.visit_id && r.id !== req.id);
        const allDone = [...visitLabRequests, { ...req, status: "Completed", lab_status: "completed", results_received: true }].every((r) => isLabRequestCompleted(r));
        if (allDone) {
          await updateDoc(doc(db, "visits", req.visit_id), { status: "In Consultation", lab_returned_at: new Date().toISOString() });
        }
        setSaving(false);
        toast.success("Results uploaded" + (allDone ? " — patient returned to clinician review" : ""));
        setActiveReq(null); setReqId(""); setForm({ result_details: "", reference_range: "", result_status: "", notes: "" });
        setTab("queue");
      } catch (err: unknown) {
        setSaving(false);
        toast.error((err as Error).message ?? "Upload failed");
      }
    };

    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div><b>{patient.first_name} {patient.last_name}</b> · <span className="font-mono">{patient.patient_code}</span></div>
          <div>Test: <b>{req.test_type}</b></div>
          <div className="text-xs text-muted-foreground">Requested by {req.requested_by}</div>
        </div>
        <Field label="Test Result" required><textarea rows={4} className={inputCls(errs.result_details)} value={form.result_details} onChange={(e) => setForm({ ...form, result_details: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reference Range"><input className={inputCls()} value={form.reference_range} onChange={(e) => setForm({ ...form, reference_range: e.target.value })} /></Field>
          <Field label="Result Status" required>
            <select className={inputCls(errs.result_status)} value={form.result_status} onChange={(e) => setForm({ ...form, result_status: e.target.value })}>
              <option value="">Select…</option><option>Normal</option><option>Abnormal</option><option>Critical</option>
            </select>
          </Field>
        </div>
        <Field label="Additional Notes"><textarea rows={2} className={inputCls()} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="text-xs text-muted-foreground">Tested by: {staff?.first_name} {staff?.last_name}</div>
        <button disabled={saving} className="flex items-center gap-2 rounded-md bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">{saving ? <Spinner /> : null} Upload Results</button>
      </form>
    );
  }

  function HistoryTab() {
    const rows = labResults.filter((r) => isToday(r.uploaded_at)).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    if (!rows.length) return <Empty />;
    return (
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Test</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Time</th></tr></thead>
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
                <td className="px-3 py-2">{new Date(r.uploaded_at).toLocaleTimeString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
}
