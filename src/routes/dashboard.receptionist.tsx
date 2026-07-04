import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { collection, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildInsuranceNotificationPayload, nextCode, validInsuranceNumber } from "@/lib/firestore-helpers";
import { useAuth } from "@/context/AuthContext";
import { usePatientData, type Patient, type Payment, type Visit } from "@/context/PatientDataContext";
import { RoleGuard, RoleHeader, FlowTracker, StatCard, Tabs, Empty, Spinner, Field, inputCls, Modal, useToast, statusBadge, isToday, ageFromDob } from "@/components/his/shared";
import { Search, Banknote, Shield, Smartphone, Printer } from "lucide-react";

export const Route = createFileRoute("/dashboard/receptionist")({ component: () => <RoleGuard role="Receptionist"><Dashboard /></RoleGuard> });

type Tab = "register" | "queue" | "search" | "records" | "payments";

const INSURANCE = ["SHA/NHIF","AAR","Britam","Jubilee","CIC","Other"];

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function Dashboard() {
  const { staff } = useAuth();
  const { patients, visits, payments, outboundNotifications } = usePatientData();
  const { toast, ui: toastUi } = useToast();
  const [tab, setTab] = useState<Tab>("register");
  const [paymentFor, setPaymentFor] = useState<{ patient: Patient; visit: Visit } | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<{ payment: Payment; patient: Patient } | null>(null);

  const todays = visits.filter((v) => isToday(v.visit_date));
  const activeStatuses = ["Waiting","Awaiting Insurance Approval","Waiting for Triage","In Triage","Waiting for Consultation","In Consultation","In Lab","Waiting for Pharmacy"];
  const stats = {
    total: todays.length,
    active: todays.filter((v) => activeStatuses.includes(v.status)).length,
    waitingTriage: todays.filter((v) => v.status === "Waiting for Triage" || v.status === "Waiting").length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <RoleHeader title="Receptionist Dashboard" accent="bg-sky-600" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <FlowTracker />
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Total Patients Today" value={stats.total} />
          <StatCard label="Active Visits" value={stats.active} tone="ok" />
          <StatCard label="Waiting for Triage" value={stats.waitingTriage} tone="warn" />
        </div>
        <Tabs
          accent="bg-sky-600"
          current={tab}
          onChange={(id) => setTab(id as Tab)}
          tabs={[
            { id: "register", label: "Register Patient" },
            { id: "queue", label: "Patient Queue" },
            { id: "search", label: "Search Patient" },
            { id: "records", label: "Patient Records" },
            { id: "payments", label: "Payments" },
          ]}
        />
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {tab === "register" ? <RegisterTab onRegistered={(patient, visit) => setPaymentFor({ patient, visit })} /> : null}
          {tab === "queue" ? <QueueTab onCollect={(p, v) => setPaymentFor({ patient: p, visit: v })} /> : null}
          {tab === "search" ? <SearchTab /> : null}
          {tab === "records" ? <RecordsTab /> : null}
          {tab === "payments" ? <PaymentsTab /> : null}
        </div>
      </div>

      <PaymentModal
        open={!!paymentFor}
        onClose={() => setPaymentFor(null)}
        patient={paymentFor?.patient ?? null}
        visit={paymentFor?.visit ?? null}
        staffId={staff?.staff_id ?? ""}
        staffName={staff ? `${staff.first_name} ${staff.last_name}` : ""}
        onDone={(msg, mpesaReceipt) => {
          toast.success(msg);
          setPaymentFor(null);
          if (mpesaReceipt) setReceiptPayment(mpesaReceipt);
        }}
        onError={(msg) => toast.error(msg)}
      />
      <MpesaReceiptModal
        open={!!receiptPayment}
        onClose={() => setReceiptPayment(null)}
        payment={receiptPayment?.payment ?? null}
        patient={receiptPayment?.patient ?? null}
        staffName={staff ? `${staff.first_name} ${staff.last_name}` : ""}
      />
      {toastUi}
    </div>
  );

  function RegisterTab({ onRegistered }: { onRegistered: (p: Patient, v: Visit) => void }) {
    const [form, setForm] = useState({ first_name: "", last_name: "", date_of_birth: "", gender: "", phone_number: "", insurance_number: "", visit_reason: "" });
    const [lookup, setLookup] = useState("");
    const [selectedExistingPatientId, setSelectedExistingPatientId] = useState<string | null>(null);
    const [errs, setErrs] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);

    const matchingPatients = useMemo(() => {
      const q = lookup.trim().toLowerCase();
      if (!q) return [] as Patient[];
      return patients.filter((p) => {
        const haystack = [p.patient_code, p.first_name, p.last_name, `${p.first_name} ${p.last_name}`, p.phone_number, p.insurance_number ?? ""].join(" ").toLowerCase();
        return haystack.includes(q);
      }).slice(0, 6);
    }, [lookup, patients]);

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      const required = ["first_name","last_name","date_of_birth","gender","phone_number","visit_reason"] as const;
      const next: Record<string, boolean> = {};
      required.forEach((k) => { if (!form[k]) next[k] = true; });
      setErrs(next);
      if (Object.keys(next).length) { toast.error("Please fill required fields"); return; }
      setSaving(true);
      try {
        const now = new Date().toISOString();
        const visitRef = doc(collection(db, "visits"));
        const selectedPatient = selectedExistingPatientId ? patients.find((p) => p.id === selectedExistingPatientId) ?? null : null;
        const patientId = selectedPatient ? selectedPatient.id : doc(collection(db, "patients")).id;
        let patientCode = selectedPatient?.patient_code ?? "";
        const batch = writeBatch(db);
        if (!selectedPatient) {
          patientCode = await nextCode("PAT", "patients");
          const patientPayload = {
            ...form,
            insurance_number: form.insurance_number || null,
            patient_code: patientCode,
            registered_by: staff!.staff_id,
            registered_at: now,
          };
          const newPatientRef = doc(db, "patients", patientId);
          batch.set(newPatientRef, patientPayload);
        } else if (form.insurance_number && !selectedPatient.insurance_number) {
          batch.update(doc(db, "patients", selectedPatient.id), { insurance_number: form.insurance_number });
        }
        const visitPayload = {
          patient_id: patientId,
          status: "Waiting",
          visit_date: now,
          created_by: staff!.staff_id,
        };
        batch.set(visitRef, visitPayload);
        await batch.commit();
        setSaving(false);
        setForm({ first_name: "", last_name: "", date_of_birth: "", gender: "", phone_number: "", insurance_number: "", visit_reason: "" });
        setLookup("");
        setSelectedExistingPatientId(null);
        toast.success(selectedPatient ? `Existing patient reused: ${selectedPatient.patient_code}` : `Patient registered: ${patientCode}`);
        onRegistered(
          (selectedPatient ? selectedPatient : { id: patientId, ...form, insurance_number: form.insurance_number || null, patient_code: patientCode, registered_by: staff!.staff_id, registered_at: now }) as Patient,
          { id: visitRef.id, ...visitPayload } as Visit,
        );
      } catch (err: unknown) {
        setSaving(false);
        toast.error((err as Error).message ?? "Failed");
      }
    };

    return (
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-3 rounded-md border bg-muted/20 p-3">
          <Field label="Find Existing Patient">
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Search by name, phone, patient ID, or insurance number" className={inputCls()} />
          </Field>
          {matchingPatients.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {matchingPatients.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setSelectedExistingPatientId(p.id);
                    setForm({
                      first_name: p.first_name,
                      last_name: p.last_name,
                      date_of_birth: p.date_of_birth,
                      gender: p.gender,
                      phone_number: p.phone_number,
                      insurance_number: p.insurance_number ?? "",
                      visit_reason: p.visit_reason,
                    });
                  }}
                  className="rounded-md border bg-white p-3 text-left text-sm hover:border-sky-300 hover:bg-sky-50"
                >
                  <div className="font-semibold">{p.first_name} {p.last_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.patient_code}</div>
                  <div className="text-xs text-muted-foreground">DOB: {p.date_of_birth} · Phone: {p.phone_number}</div>
                  <div className="text-xs text-muted-foreground">Insurance: {p.insurance_number ?? "—"}</div>
                </button>
              ))}
            </div>
          ) : lookup.trim() ? <p className="text-xs text-muted-foreground">No existing patient matches the current search.</p> : null}
        </div>
        <Field label="First Name" required><input className={inputCls(errs.first_name)} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
        <Field label="Last Name" required><input className={inputCls(errs.last_name)} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
        <Field label="Date of Birth" required><input type="date" className={inputCls(errs.date_of_birth)} value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></Field>
        <Field label="Gender" required>
          <select className={inputCls(errs.gender)} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </Field>
        <Field label="Phone Number" required><input className={inputCls(errs.phone_number)} value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} /></Field>
        <Field label="Insurance Number (optional)"><input className={inputCls()} value={form.insurance_number} onChange={(e) => setForm({ ...form, insurance_number: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Visit Reason" required><textarea rows={3} className={inputCls(errs.visit_reason)} value={form.visit_reason} onChange={(e) => setForm({ ...form, visit_reason: e.target.value })} /></Field>
        </div>
        <div className="sm:col-span-2">
          <button disabled={saving} className="flex items-center gap-2 rounded-md bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving ? <Spinner /> : null} Register Patient & Continue to Payment
          </button>
        </div>
      </form>
    );
  }

  function QueueTab({ onCollect }: { onCollect: (p: Patient, v: Visit) => void }) {
    const { patients } = usePatientData();
    const rows = todays.slice().sort((a, b) => a.visit_date.localeCompare(b.visit_date));
    if (!rows.length) return <Empty />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Patient ID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const p = patients.find((x) => x.id === v.patient_id);
              const pay = payments.find((py) => py.visit_id === v.id);
              if (!p) return null;
              return (
                <tr key={v.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{p.patient_code}</td>
                  <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                  <td className="px-3 py-2">{ageFromDob(p.date_of_birth)}</td>
                  <td className="px-3 py-2">{p.visit_reason}</td>
                  <td className="px-3 py-2">{new Date(v.visit_date).toLocaleTimeString()}</td>
                  <td className="px-3 py-2"><PaymentBadge payment={pay} /></td>
                  <td className="px-3 py-2">{v.status}</td>
                  <td className="px-3 py-2">
                    {!pay || (pay.method !== "Insurance" && pay.status === "Pending") ? (
                      <button onClick={() => onCollect(p, v)} className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700">Collect Payment</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function SearchTab() {
    const [q, setQ] = useState("");
    const results = useMemo(() => {
      if (!q.trim()) return [] as Patient[];
      const s = q.toLowerCase();
      return patients.filter((p) => p.first_name.toLowerCase().includes(s) || p.last_name.toLowerCase().includes(s) || p.patient_code.toLowerCase().includes(s));
    }, [q]);
    return (
      <div>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or patient ID…" className={`${inputCls()} pl-9`} />
        </div>
        <div className="mt-4">
          {!q.trim() ? <Empty message="Start typing to search" /> : !results.length ? <Empty /> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">DOB</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Visits</th></tr></thead>
              <tbody>
                {results.map((p) => (
                  <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{p.patient_code}</td><td className="px-3 py-2">{p.first_name} {p.last_name}</td><td className="px-3 py-2">{p.date_of_birth}</td><td className="px-3 py-2">{p.phone_number}</td><td className="px-3 py-2">{visits.filter((v) => v.patient_id === p.id).length}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  function RecordsTab() {
    if (!patients.length) return <Empty />;
    const sorted = patients.slice().sort((a, b) => b.registered_at.localeCompare(a.registered_at));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Gender</th><th className="px-3 py-2">DOB</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Insurance</th><th className="px-3 py-2">Registered</th></tr></thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{p.patient_code}</td><td className="px-3 py-2">{p.first_name} {p.last_name}</td><td className="px-3 py-2">{p.gender}</td><td className="px-3 py-2">{p.date_of_birth}</td><td className="px-3 py-2">{p.phone_number}</td><td className="px-3 py-2">{p.insurance_number ?? "—"}</td><td className="px-3 py-2">{new Date(p.registered_at).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function PaymentsTab() {
    const today = payments.filter((p) => isToday(p.processed_at));
    const cash = today.filter((p) => p.method === "Cash" && p.status === "Paid").reduce((s, p) => s + Number(p.amount), 0);
    const insCount = today.filter((p) => p.method === "Insurance").length;
    const mpesa = today.filter((p) => p.method === "MPesa" && p.status === "Paid").reduce((s, p) => s + Number(p.amount), 0);
    const pending = today.filter((p) => p.status === "Pending").length;
    const awaitingApproval = today.filter((p) => p.method === "Insurance" && p.status === "Pending Approval");
    const totalRevenue = cash + mpesa;

    const approveInsurance = async (paymentId: string) => {
      const payment = payments.find((p) => p.id === paymentId);
      if (!payment) return;
      const visit = visits.find((v) => v.id === payment.visit_id);
      const patient = patients.find((p) => p.id === payment.patient_id);
      if (!visit || !patient) return;
      const notification = outboundNotifications.find((item) => item.payment_id === paymentId);
      const batch = writeBatch(db);
      batch.update(doc(db, "payments", paymentId), { status: "Approved" });
      batch.update(doc(db, "visits", visit.id), { status: "Waiting for Triage" });
      if (notification) {
        batch.update(doc(db, "outbound_notifications", notification.id), {
          status: "Sent",
          delivered_at: new Date().toISOString(),
          delivered_by: staff?.staff_id ?? null,
        });
      }
      await batch.commit();
      toast.success(`Insurance approved for ${patient.patient_code}`);
    };

    const rejectInsurance = async (paymentId: string) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "payments", paymentId), { status: "Rejected" });
      await batch.commit();
      toast.error("Insurance claim rejected");
    };
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total Cash (KES)" value={cash.toLocaleString()} tone="ok" />
          <StatCard label="Insurance Claims" value={insCount} />
          <StatCard label="M-Pesa Collected (KES)" value={mpesa.toLocaleString()} tone="ok" />
          <StatCard label="Pending" value={pending} tone="warn" />
          <StatCard label="Total Revenue (KES)" value={totalRevenue.toLocaleString()} tone="ok" />
        </div>
        {!today.length ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Receipt</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">M-Pesa Ref</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Time</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {today.map((p) => {
                  const pat = patients.find((x) => x.id === p.patient_id);
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td>
                      <td className="px-3 py-2">{pat ? `${pat.first_name} ${pat.last_name}` : "—"}</td>
                      <td className="px-3 py-2">{p.method === "MPesa" ? "M-Pesa" : p.method}</td>
                      <td className="px-3 py-2">{p.insurance_provider ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.mpesa_reference ?? "—"}</td>
                      <td className="px-3 py-2">KES {Number(p.amount).toLocaleString()}</td>
                      <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${statusBadge(p.status)}`}>{p.status}</span></td>
                      <td className="px-3 py-2">{new Date(p.processed_at).toLocaleTimeString()}</td>
                      <td className="px-3 py-2">
                        {p.method === "Insurance" && p.status === "Pending Approval" ? (
                          <div className="flex gap-2">
                            <button onClick={() => approveInsurance(p.id)} className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700">Approve</button>
                            <button onClick={() => rejectInsurance(p.id)} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Reject</button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {awaitingApproval.length ? (
          <div className="rounded-md border bg-sky-50 p-3 text-sm text-sky-800">
            {awaitingApproval.length} insurance claim(s) awaiting provider approval. The demo inbox entry is queued in Firestore and will flip to Sent when approved.
          </div>
        ) : null}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Insurance Demo Inbox</h3>
              <p className="text-xs text-muted-foreground">This replaces real email for the lecturer demo.</p>
            </div>
          </div>
          {!outboundNotifications.length ? (
            <Empty message="No demo notifications yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Subject</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Delivered</th></tr>
                </thead>
                <tbody>
                  {outboundNotifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((n) => (
                    <tr key={n.id} className="border-t">
                      <td className="px-3 py-2">{n.channel ?? "Demo Inbox"}</td>
                      <td className="px-3 py-2">{n.provider}</td>
                      <td className="px-3 py-2">{n.recipient_email}</td>
                      <td className="px-3 py-2">{n.subject}</td>
                      <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${statusBadge(n.status)}`}>{n.status}</span></td>
                      <td className="px-3 py-2">{new Date(n.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">{n.delivered_at ? new Date(n.delivered_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }
}

function PaymentBadge({ payment }: { payment?: Payment }) {
  if (!payment) {
    return <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Pending</span>;
  }
  if (payment.method === "Insurance" && payment.status === "Pending Approval") {
    return <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Insurance awaiting approval</span>;
  }
  if (payment.method === "Insurance" && payment.status === "Rejected") {
    return <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Insurance rejected</span>;
  }
  if (payment.status === "Pending") {
    return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Pending</span>;
  }
  if (payment.method === "MPesa") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex w-fit items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700" title={payment.mpesa_reference ?? ""}>
          <Smartphone className="size-3" /> Paid M-Pesa
        </span>
        {payment.mpesa_reference ? <span className="font-mono text-[10px] text-muted-foreground">{payment.mpesa_reference}</span> : null}
      </div>
    );
  }
  if (payment.method === "Insurance") {
    return <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Insurance approved</span>;
  }
  return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Paid Cash</span>;
}

type PaymentMethod = "Cash" | "Insurance" | "MPesa";

function validKenyanPhone(phone: string) {
  return /^(?:\+254(?:7|1)\d{8}|0(?:7|1)\d{8})$/.test(phone.trim());
}
function validMpesaRef(ref: string) {
  return /^[A-Z0-9]{8,12}$/.test(ref.trim().toUpperCase());
}

function PaymentModal({ open, onClose, patient, visit, staffId, staffName, onDone, onError }: { open: boolean; onClose: () => void; patient: Patient | null; visit: Visit | null; staffId: string; staffName: string; onDone: (msg: string, mpesaReceipt?: { payment: Payment; patient: Patient }) => void; onError: (msg: string) => void }) {
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("SHA/NHIF");
  const [insNum, setInsNum] = useState("");
  const [phone, setPhone] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [errs, setErrs] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const prevPatientId = useRef<string | null>(null);

  if (!open || !patient || !visit) return null;

  if (prevPatientId.current !== patient.id) {
    prevPatientId.current = patient.id;
    setPhone(patient.phone_number ?? "");
    setInsNum(patient.insurance_number ?? "");
    setMethod(patient.insurance_number ? "Insurance" : "Cash");
  }

  const methods: { id: PaymentMethod; label: string; Icon: typeof Banknote }[] = [
    { id: "Cash", label: "Cash", Icon: Banknote },
    { id: "Insurance", label: "Insurance", Icon: Shield },
    { id: "MPesa", label: "M-Pesa", Icon: Smartphone },
  ];

  const submitPayment = async () => {
    const next: Record<string, string | boolean> = {};
    if (method === "MPesa") {
      if (!phone.trim()) next.phone = true;
      else if (!validKenyanPhone(phone)) next.phone = "Invalid Kenyan phone number format";
      if (!amount || Number(amount) <= 0) next.amount = true;
      if (!mpesaRef.trim()) next.ref = true;
      else if (!validMpesaRef(mpesaRef)) next.ref = "Invalid M-Pesa reference";
    }
    if (method === "Cash" && (!amount || Number(amount) <= 0)) next.amount = true;
    if (method === "Insurance") {
      if (!insNum.trim()) next.ins = true;
      else if (!validInsuranceNumber(insNum)) next.ins = "Invalid insurance number";
      if (!amount || Number(amount) < 0) next.amount = true;
    }
    setErrs(next);
    if (Object.keys(next).length) { onError("Please fix payment form errors"); return; }
    setSaving(true);
    try {
      const receipt_number = await nextCode("RCP", "receipts");
      const payment_id = await nextCode("PAY", "payments_seq");
      const processed_at = new Date().toISOString();
      const paymentStatus = method === "Insurance" ? "Pending Approval" : "Paid";
      const paymentRef = doc(collection(db, "payments"));
      const visitRef = doc(db, "visits", visit.id);
      const batch = writeBatch(db);
      const docPayload = {
        payment_id,
        receipt_number,
        patient_id: patient.id,
        visit_id: visit.id,
        method,
        amount: method === "Insurance" ? Number(amount || 0) : Number(amount),
        status: paymentStatus,
        processed_by: staffId,
        processed_at,
        insurance_provider: method === "Insurance" ? provider : null,
        mpesa_reference: method === "MPesa" ? mpesaRef.trim().toUpperCase() : null,
        phone_number: method === "MPesa" ? phone.trim() : null,
        insurance_number: method === "Insurance" ? insNum.trim() : null,
      };
      batch.set(paymentRef, docPayload);
      batch.update(visitRef, { status: method === "Insurance" ? "Awaiting Insurance Approval" : "Waiting for Triage" });
      if (method === "Insurance") {
        batch.set(doc(collection(db, "outbound_notifications")), buildInsuranceNotificationPayload({
          provider,
          patient: { id: patient.id, patient_code: patient.patient_code, first_name: patient.first_name, last_name: patient.last_name, insurance_number: insNum.trim() },
          visit: { id: visit.id, visit_date: visit.visit_date, status: visit.status },
          payment: { id: paymentRef.id, receipt_number, amount: Number(amount || 0), status: paymentStatus, processed_at },
          staff: { staff_id: staffId, display_name: staffName || staffId },
        }));
      }
      await batch.commit();
      setSaving(false);
      setAmount(""); setMpesaRef(""); setInsNum(""); setErrs({});
      onDone(
        method === "MPesa"
          ? `M-Pesa payment confirmed: ${receipt_number} (Ref: ${docPayload.mpesa_reference})`
          : method === "Insurance"
            ? `Insurance claim queued: ${receipt_number}. Await provider approval before service.`
            : `Payment recorded: ${receipt_number}`,
        method === "MPesa" ? { payment: { id: paymentRef.id, ...docPayload } as Payment, patient } : undefined,
      );
    } catch (err: unknown) {
      setSaving(false);
      onError((err as Error).message ?? "Payment failed");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Process Payment">
      <div className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div><span className="text-muted-foreground">Patient:</span> {patient.first_name} {patient.last_name}</div>
          <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{patient.patient_code}</span></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {methods.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setMethod(id); setErrs({}); }}
              className={`flex flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm font-medium transition ${method === id ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>

        {method === "Cash" ? (
          <Field label="Amount (KES)" required><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls()} /></Field>
        ) : null}

        {method === "Insurance" ? (
          <div className="space-y-3">
            <Field label="Insurance Provider" required>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls()}>
                {INSURANCE.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Insurance Number" required error={typeof errs.ins === "string" ? (errs.ins as string) : undefined}><input value={insNum} onChange={(e) => setInsNum(e.target.value)} className={inputCls(!!errs.ins)} /></Field>
            <Field label="Claim Amount (KES)" required><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls()} /></Field>
          </div>
        ) : null}

        {method === "MPesa" ? (
          <div className="space-y-3">
            <Field label="Patient Phone Number" required>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XXXXXXXX or +2547XXXXXXXX"
                className={inputCls(!!errs.phone)}
              />
              {typeof errs.phone === "string" ? <p className="mt-1 text-xs text-rose-600">{errs.phone}</p> : null}
            </Field>
            <Field label="Amount (KES)" required>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls(!!errs.amount)} />
            </Field>
            <Field label="STK Push Reference / M-Pesa Code" required>
              <input
                value={mpesaRef}
                onChange={(e) => setMpesaRef(e.target.value.toUpperCase())}
                placeholder="QK47XXXXXXX"
                className={inputCls(!!errs.ref)}
              />
              {typeof errs.ref === "string" ? <p className="mt-1 text-xs text-rose-600">{errs.ref}</p> : null}
            </Field>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button disabled={saving} onClick={submitPayment} className="flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving ? <Spinner /> : method === "MPesa" ? <Smartphone className="size-4" /> : null} {method === "Cash" ? "Confirm Cash Payment" : method === "MPesa" ? "Confirm M-Pesa Payment" : "Verify Insurance & Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MpesaReceiptModal({ open, onClose, payment, patient, staffName }: { open: boolean; onClose: () => void; payment: Payment | null; patient: Patient | null; staffName: string }) {
  if (!open || !payment || !patient) return null;
  const print = () => {
    const node = document.getElementById("mpesa-receipt-printable");
    if (!node) return;
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    w.document.write(`<html><head><title>Receipt ${payment.receipt_number}</title><style>body{font-family:ui-sans-serif,system-ui;padding:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 16px;color:#475569}table{width:100%;font-size:13px;border-collapse:collapse}td{padding:4px 0}td:first-child{color:#64748b;width:45%}hr{border:none;border-top:1px dashed #cbd5e1;margin:12px 0}</style></head><body>${node.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };
  return (
    <Modal open={open} onClose={onClose} title="M-Pesa Payment Receipt">
      <div id="mpesa-receipt-printable" className="rounded-md border bg-white p-4 text-sm">
        <h1 className="text-base font-semibold">Smart Hospital Information System</h1>
        <h2 className="text-xs text-muted-foreground">Official Payment Receipt</h2>
        <hr className="my-3" />
        <table className="w-full">
          <tbody>
            <tr><td className="text-muted-foreground">Receipt Number</td><td className="font-mono">{payment.receipt_number}</td></tr>
            <tr><td className="text-muted-foreground">Patient Name</td><td>{patient.first_name} {patient.last_name}</td></tr>
            <tr><td className="text-muted-foreground">Patient ID</td><td className="font-mono">{patient.patient_code}</td></tr>
            <tr><td className="text-muted-foreground">Payment Method</td><td>M-Pesa</td></tr>
            <tr><td className="text-muted-foreground">M-Pesa Reference</td><td className="font-mono">{payment.mpesa_reference}</td></tr>
            <tr><td className="text-muted-foreground">Phone Number</td><td>{payment.phone_number}</td></tr>
            <tr><td className="text-muted-foreground">Amount Paid</td><td>KES {Number(payment.amount).toLocaleString()}</td></tr>
            <tr><td className="text-muted-foreground">Date &amp; Time</td><td>{new Date(payment.processed_at).toLocaleString()}</td></tr>
            <tr><td className="text-muted-foreground">Processed By</td><td>{staffName || payment.processed_by}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm">Close</button>
        <button onClick={print} className="flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          <Printer className="size-4" /> Print Receipt
        </button>
      </div>
    </Modal>
  );
}
