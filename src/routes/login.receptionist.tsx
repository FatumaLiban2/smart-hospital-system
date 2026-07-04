import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { CredentialPage } from "@/components/his/CredentialPage";

export const Route = createFileRoute("/login/receptionist")({ component: () => (
  <CredentialPage role="Receptionist" title="Receptionist Login" accent="bg-sky-600" defaultEmail="receptionist@hospital.com" dashboardPath="/dashboard/receptionist" icon={<ClipboardList className="size-5" />} />
)});
