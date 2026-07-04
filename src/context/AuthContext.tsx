import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { signInOrSeedDemoUser } from "@/lib/firestore-helpers";

export type StaffRole = "Receptionist" | "TriageNurse" | "Clinician" | "LabTechnician" | "Pharmacist";

export interface StaffProfile {
  staff_id: string;
  role: StaffRole;
  first_name: string;
  last_name: string;
  email: string;
}

interface AuthCtx {
  loading: boolean;
  isAuthenticated: boolean;
  user: { id: string; email: string } | null;
  staff: StaffProfile | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthCtx["user"]>(null);
  const [staff, setStaff] = useState<StaffProfile | null>(null);

  useEffect(() => {
    let unsubStaff: (() => void) | null = null;
    const unsub = onAuthStateChanged(auth, (fbUser: User | null) => {
      if (unsubStaff) { unsubStaff(); unsubStaff = null; }
      if (!fbUser) {
        setUser(null); setStaff(null); setLoading(false);
        return;
      }
      setUser({ id: fbUser.uid, email: fbUser.email ?? "" });
      unsubStaff = onSnapshot(doc(db, "staff", fbUser.uid), (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setStaff({
            staff_id: d.staff_id,
            role: d.role as StaffRole,
            first_name: d.first_name,
            last_name: d.last_name,
            email: d.email,
          });
        } else {
          setStaff(null);
        }
        setLoading(false);
      });
    });
    return () => { unsub(); if (unsubStaff) unsubStaff(); };
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    try {
      await signInOrSeedDemoUser(email, password);
      return {};
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Sign in failed";
      return { error: msg };
    }
  };

  const signOut = async () => {
    await fbSignOut(auth);
    setUser(null);
    setStaff(null);
  };

  return (
    <Ctx.Provider value={{ loading, isAuthenticated: !!user, user, staff, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
