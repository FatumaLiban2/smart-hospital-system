import { createFileRoute } from "@tanstack/react-router";
import { Pill } from "lucide-react";
import { CredentialPage } from "@/components/his/CredentialPage";

export const Route = createFileRoute("/login/pharmacy")({ component: () => (
  <CredentialPage role="Pharmacist" title="Pharmacist Login" accent="bg-teal-600" defaultEmail="pharmacist@hospital.com" dashboardPath="/dashboard/pharmacy" icon={<Pill className="size-5" />} />
)});
