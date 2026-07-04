import { createFileRoute, Link } from "@tanstack/react-router";
import { Stethoscope, HeartPulse, ClipboardList, FlaskConical, Pill } from "lucide-react";

export const Route = createFileRoute("/login/")({
  head: () => ({ meta: [{ title: "Smart HIS — Role Selection" }] }),
  component: RoleSelection,
});

const roles = [
  { to: "/login/receptionist", label: "Receptionist", desc: "Patient registration, billing & queue", icon: ClipboardList, color: "bg-sky-600 hover:bg-sky-700", ring: "ring-sky-200" },
  { to: "/login/triage", label: "Triage Nurse", desc: "Vitals & patient prioritization", icon: HeartPulse, color: "bg-emerald-600 hover:bg-emerald-700", ring: "ring-emerald-200" },
  { to: "/login/clinician", label: "Clinician", desc: "Consultation, diagnosis & treatment", icon: Stethoscope, color: "bg-violet-600 hover:bg-violet-700", ring: "ring-violet-200" },
  { to: "/login/lab", label: "Laboratory Technician", desc: "Process tests & upload results", icon: FlaskConical, color: "bg-orange-600 hover:bg-orange-700", ring: "ring-orange-200" },
  { to: "/login/pharmacy", label: "Pharmacist", desc: "Dispensing & inventory management", icon: Pill, color: "bg-teal-600 hover:bg-teal-700", ring: "ring-teal-200" },
] as const;

function RoleSelection() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sky-600 text-white shadow">
            <Stethoscope className="size-7" />
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Smart Hospital Information System</h1>
          <p className="mt-2 text-base text-slate-600">Small-Scale Outpatient Clinic Portal</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => {
            const Icon = r.icon;
            return (
              <Link key={r.to} to={r.to}
                className={`group flex flex-col items-start gap-3 rounded-xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ring-1 ${r.ring}`}>
                <div className={`flex size-12 items-center justify-center rounded-lg text-white ${r.color}`}>
                  <Icon className="size-6" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{r.label}</div>
                  <div className="mt-1 text-sm text-slate-600">{r.desc}</div>
                </div>
                <div className="mt-2 text-xs font-medium text-sky-700 group-hover:underline">Continue →</div>
              </Link>
            );
          })}
        </div>

        <p className="mt-12 text-center text-xs text-slate-500">
          Powered by Smart HIS — Kenya Healthcare Digitization Initiative
        </p>
      </div>
    </div>
  );
}
