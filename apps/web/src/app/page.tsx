import { AuthProvider } from "@/components/auth-provider";
import { ProjectWorkspace } from "@/components/project-workspace";

export default function Home() {
  return (
    <AuthProvider>
      <ProjectWorkspace />
    </AuthProvider>
  );
}
