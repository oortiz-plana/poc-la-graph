import { AuthProvider } from "@/components/auth-provider";
import { TenantGovernanceWorkspace } from "@/components/tenant-governance-workspace";

export default function GovernancePage() {
  return (
    <AuthProvider>
      <TenantGovernanceWorkspace />
    </AuthProvider>
  );
}
