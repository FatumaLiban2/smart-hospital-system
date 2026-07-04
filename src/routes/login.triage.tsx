import { createFileRoute } from "@tanstack/react-router";
import { HeartPulse } from "lucide-react";
import { CredentialPage } from "@/components/his/CredentialPage";

export const Route = createFileRoute("/login/triage")({ component: () => (
  <CredentialPage role="TriageNurse" title="Triage Nurse Login" accent="bg-emerald-600" defaultEmail="triage@hospital.com" dashboardPath="/dashboard/triage" icon={<HeartPulse className="size-5" />} />
)});
