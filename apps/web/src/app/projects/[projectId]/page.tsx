import { AuthProvider } from "@/components/auth-provider";
import {
  ProjectDetailWorkspace,
  type ProjectSection,
} from "@/components/project-detail-workspace";

const sections = new Set<ProjectSection>([
  "overview",
  "documents",
  "access",
  "builds",
  "settings",
]);

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const requested = query.section;
  const section =
    requested && sections.has(requested as ProjectSection)
      ? (requested as ProjectSection)
      : "overview";

  return (
    <AuthProvider>
      <ProjectDetailWorkspace projectId={projectId} section={section} />
    </AuthProvider>
  );
}
