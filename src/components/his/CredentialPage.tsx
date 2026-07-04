import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { useAuth, type StaffRole } from "@/context/AuthContext";
import { ensureInventorySeeded } from "@/lib/firestore-helpers";

interface Props {
  role: StaffRole;
  title: string;
  accent: string;
  defaultEmail: string;
  dashboardPath: "/dashboard/receptionist" | "/dashboard/triage" | "/dashboard/clinician" | "/dashboard/lab" | "/dashboard/pharmacy";
  icon: ReactNode;
}

export function CredentialPage({ role, title, accent, defaultEmail, dashboardPath, icon }: Props) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("Hospital@2026");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try { await ensureInventorySeeded(); } catch { /* non-fatal */ }
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) { setError(error); return; }
    await new Promise((r) => setTimeout(r, 400));
    navigate({ to: dashboardPath });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className={`${accent} px-4 py-6 text-white shadow`}>
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-white/15">{icon}</div>
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="text-sm text-white/80">Smart Hospital Information System</div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-md px-4">
        <Link to="/login" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" /> Back to Role Selection
        </Link>
        <form onSubmit={onSubmit} className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">Enter your credentials to continue.</p>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
              <div className="relative">
                <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-2 flex items-center text-slate-500">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </label>
            {error ? <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            <button type="submit" disabled={loading}
              className={`flex w-full items-center justify-center gap-2 rounded-md ${accent} px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60`}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              Login as {role.replace(/([A-Z])/g, " $1").trim()}
            </button>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Clinic Connect<span className="font-mono"></span>
              <br />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
