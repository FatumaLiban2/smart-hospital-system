
# Smart Hospital Information System — Build Plan

## Stack
- **Frontend**: TanStack Start (existing scaffold) + Tailwind + lucide-react
- **Backend**: Lovable Cloud (Postgres + Auth + Realtime) — replaces Firebase. Same capabilities, no external account, no API keys.
- **Real-time**: Supabase Realtime channels subscribed in `PatientDataContext` (equivalent to Firestore `onSnapshot`).

## Database (one migration)
Tables, all in `public` with RLS + grants:
`staff`, `patients`, `visits`, `payments`, `triage_records`, `consultations`, `lab_requests`, `lab_results`, `prescriptions`, `inventory`.

Each user-facing table:
- `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`
- RLS policy: `authenticated` can read/write (clinic-internal app — every staff role needs broad access by design).
- Added to `supabase_realtime` publication for live updates.

Seed in the same migration:
- 20 inventory rows (Paracetamol … Oral Contraceptives, reorder=50).
- 5 staff rows mapped to auth users.
- Sequences for `PAT-001`, `RCP-001`, `LAB-001`, `RX-001`, `VST-001`.

Auth users (`receptionist@hospital.com` … `pharmacist@hospital.com`, password `Hospital@2026`) seeded via a one-time server function the user triggers from the login screen if they don't exist yet — Lovable Cloud doesn't let migrations create auth users directly.

## Frontend structure
```
src/
  lib/supabase-realtime.ts            # channel helper
  context/AuthContext.tsx             # session + staff row (role, staffId, name)
  context/PatientDataContext.tsx      # realtime tables → React state
  components/his/                     # shared: FlowTracker, StatsCard, Modal, Toast, RoleHeader, ProtectedRoute, PaymentModal, etc.
  routes/
    index.tsx                         # redirects to /login
    login.tsx                         # role selection grid
    login.receptionist.tsx
    login.triage.tsx
    login.clinician.tsx
    login.lab.tsx
    login.pharmacy.tsx
    dashboard.receptionist.tsx
    dashboard.triage.tsx
    dashboard.clinician.tsx
    dashboard.lab.tsx
    dashboard.pharmacy.tsx
```
Routing uses TanStack file-based routing (dots = slashes). A small `RoleGuard` wrapper inside each dashboard component checks `AuthContext` (role match) and redirects to `/login` otherwise. No `_authenticated/` layout — the role guard handles it inline so each dashboard can require its specific role.

## Per-dashboard feature coverage
Implemented exactly per spec:
- **Receptionist** (blue): Register Patient + Payment modal (Cash/Insurance/Skip), Patient Queue, Search, Records, Payments tabs.
- **Triage** (green): Queue, Record Vitals (auto-BMI + category), Triage History.
- **Clinician** (purple): Queue with priority color, Consultation form (patient + vitals read-only, diagnosis/plan, lab requests, prescriptions), Lab Results, Prescriptions Issued.
- **Lab** (orange): Pending Requests, Upload Results (auto-advances visit to Pharmacy when all results in), Results History.
- **Pharmacy** (teal): Prescription Queue, Dispense (decrements inventory + recalculates status + discharges), Inventory with Add Stock, Dispensing History.

All dashboards share the live Patient Flow Tracker (counts grouped by `visits.status`) at the top.

## Cross-cutting
- Auto-IDs (`PAT-001`, `RCP-001`, `LAB-001`, `RX-001`) generated via Postgres sequences + format trigger so concurrent inserts don't collide.
- Required-field validation with red border + toast on error.
- Loading spinner during writes; success/error toasts (`sonner`).
- Responsive (Tailwind grid, works on tablet).
- All colors via design tokens added to `src/styles.css` (role-specific accent tokens: `--role-reception`, `--role-triage`, etc.) — no hardcoded hex in components.

## Out of scope / simplifications I'll call out
- Firebase is replaced by Lovable Cloud (your choice). All "Firestore" wording in the spec is implemented as Postgres tables + Realtime subscriptions — behavior is identical from the user's perspective.
- "Filter prescriptions by this clinician today" uses `auth.uid()` match where the `staff.staff_id` column links to the auth user.
