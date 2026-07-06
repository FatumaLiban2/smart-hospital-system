import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Activity, Loader2 } from "lucide-react";
import { useAuth, type StaffRole } from "@/context/AuthContext";
import { usePatientData, VISIT_STATUSES } from "@/context/PatientDataContext";

export function ageFromDob(dob: string) {
  const d = new Date(dob);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function isToday(iso: string | null | undefined) {
  return iso?.slice(0, 10) === todayISO();
}

export function RoleGuard({ role, children }: { role: StaffRole; children: ReactNode }) {
  const { loading, isAuthenticated, staff } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate({ to: "/login" });
    else if (staff && staff.role !== role) navigate({ to: "/login" });
  }, [loading, isAuthenticated, staff, role, navigate]);
  if (loading || !isAuthenticated || !staff || staff.role !== role) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}

export function RoleHeader({ title, accent }: { title: string; accent: string }) {
  const { staff, signOut } = useAuth();
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <header className={`${accent} text-white shadow-md`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
          <p className="text-sm text-white/85">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-sm">
            <div className="font-medium">Logged in as {staff?.first_name} {staff?.last_name}</div>
            <div className="text-white/80">{staff?.staff_id}</div>
          </div>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
            className="flex items-center gap-1 rounded-md bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25"
          >
            <LogOut className="size-4" /> Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export function FlowTracker() {
  const { visits } = usePatientData();
  const today = todayISO();
  const todays = visits.filter((v) => v.visit_date.slice(0, 10) === today);
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Activity className="size-4" /> Live Patient Flow — Today
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {VISIT_STATUSES.map((status) => {
          const count = todays.filter((v) => v.status === status).length;
          return (
            <div key={status} className="rounded-md bg-muted/50 px-3 py-2 text-center">
              <div className="text-2xl font-bold text-foreground">{count}</div>
              <div className="text-xs text-muted-foreground leading-tight">{status}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "default" | "warn" | "danger" | "ok" }) {
  const toneCls = tone === "danger" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${toneCls}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, current, onChange, accent }: { tabs: { id: string; label: string }[]; current: string; onChange: (id: string) => void; accent: string }) {
  return (
    <div className="flex flex-wrap gap-1 border-b">
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${active ? `${accent} text-white rounded-t-md` : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ message = "No records found" }: { message?: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{message}</div>;
}

export function Spinner() {
  return <Loader2 className="size-4 animate-spin" />;
}

export function priorityBadge(priority?: string) {
  const map: Record<string, string> = {
    Emergency: "bg-rose-100 text-rose-700 border-rose-200",
    Urgent: "bg-orange-100 text-orange-700 border-orange-200",
    "Semi-Urgent": "bg-amber-100 text-amber-700 border-amber-200",
    "Non-Urgent": "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
  return map[priority ?? ""] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

export function statusBadge(status: string) {
  const map: Record<string, string> = {
    Paid: "bg-emerald-100 text-emerald-700",
    Pending: "bg-amber-100 text-amber-700",
    Queued: "bg-sky-100 text-sky-700",
    Sent: "bg-emerald-100 text-emerald-700",
    "Pending Approval": "bg-sky-100 text-sky-700",
    Approved: "bg-emerald-100 text-emerald-700",
    Rejected: "bg-rose-100 text-rose-700",
    "Awaiting Insurance Approval": "bg-sky-100 text-sky-700",
    "In Stock": "bg-emerald-100 text-emerald-700",
    "Low Stock": "bg-amber-100 text-amber-700",
    "Out of Stock": "bg-rose-100 text-rose-700",
    Normal: "bg-emerald-100 text-emerald-700",
    Abnormal: "bg-amber-100 text-amber-700",
    Critical: "bg-rose-100 text-rose-700",
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

export function Field({ label, required, children, error }: { label: string; required?: boolean; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-foreground">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}

export function inputCls(invalid?: boolean) {
  return `w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-1 ${invalid ? "border-rose-500 focus:ring-rose-400" : "border-input focus:ring-primary/30"}`;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={`mt-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-lg bg-card shadow-xl`}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const toast = {
    success: (text: string) => setMsg({ kind: "ok", text }),
    error: (text: string) => setMsg({ kind: "err", text }),
  };
  const ui = msg ? (
    <div className={`fixed bottom-6 right-6 z-60 rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg ${msg.kind === "ok" ? "bg-emerald-600" : "bg-rose-600"}`}>
      {msg.text}
    </div>
  ) : null;
  return { toast, ui };
}
