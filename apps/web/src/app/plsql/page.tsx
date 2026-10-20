import { getTranslations } from "next-intl/server";
import { AuthProvider } from "@/components/auth-provider";
import { PlsqlAnalysisWorkspace } from "@/components/plsql-analysis/plsql-analysis-workspace";

export async function generateMetadata() {
  const t = await getTranslations("plsqlWorkspace");
  return { title: t("pageTitle") };
}

export default function PlsqlAnalysisPage() {
  return (
    <AuthProvider>
      <PlsqlAnalysisWorkspace />
    </AuthProvider>
  );
}
