import { AuthProvider } from "@/components/auth-provider";
import { PlsqlAnalysisWorkspace } from "@/components/plsql-analysis/plsql-analysis-workspace";

export const metadata = { title: "PL/SQL analysis" };

export default function PlsqlAnalysisPage() {
  return (
    <AuthProvider>
      <PlsqlAnalysisWorkspace />
    </AuthProvider>
  );
}
