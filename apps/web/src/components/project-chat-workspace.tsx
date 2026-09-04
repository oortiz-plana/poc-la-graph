"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listProjectFiles, listProjects } from "@/lib/api";
import type { Project, SnapshotFile } from "@/lib/contracts";
import { ChatWorkspace } from "./chat-workspace";

export function ProjectChatWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project>();
  const [files, setFiles] = useState<SnapshotFile[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    void Promise.all([listProjects(), listProjectFiles(projectId)])
      .then(([projects, projectFiles]) => {
        const project = projects.find((item) => item.id === projectId);
        if (project) {
          setProject(project);
          setFiles(projectFiles);
        } else setError(true);
      })
      .catch(() => setError(true));
  }, [projectId]);

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div>
          <p role="alert">The project conversation could not be opened.</p>
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="mt-4 inline-flex min-h-11 items-center text-primary underline"
          >
            Return to project
          </Link>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="grid min-h-dvh place-items-center p-6" role="status">
        Opening project conversation…
      </main>
    );
  }

  return (
    <ChatWorkspace
      projectId={projectId}
      project={project}
      initialFiles={files}
    />
  );
}
