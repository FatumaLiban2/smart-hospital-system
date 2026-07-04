import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { CredentialPage } from "@/components/his/CredentialPage";

export const Route = createFileRoute("/login/lab")({ component: () => (
  <CredentialPage role="LabTechnician" title="Lab Technician Login" accent="bg-orange-600" defaultEmail="lab@hospital.com" dashboardPath="/dashboard/lab" icon={<FlaskConical className="size-5" />} />
)});
