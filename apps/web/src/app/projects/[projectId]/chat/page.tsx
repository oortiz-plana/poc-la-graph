import { AuthProvider } from "@/components/auth-provider";
import { ProjectChatWorkspace } from "@/components/project-chat-workspace";

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <AuthProvider>
      <ProjectChatWorkspace projectId={projectId} />
    </AuthProvider>
  );
}
