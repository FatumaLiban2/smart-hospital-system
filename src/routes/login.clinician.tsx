import { createFileRoute } from "@tanstack/react-router";
import { Stethoscope } from "lucide-react";
import { CredentialPage } from "@/components/his/CredentialPage";

export const Route = createFileRoute("/login/clinician")({ component: () => (
  <CredentialPage role="Clinician" title="Clinician Login" accent="bg-violet-600" defaultEmail="clinician@hospital.com" dashboardPath="/dashboard/clinician" icon={<Stethoscope className="size-5" />} />
)});
