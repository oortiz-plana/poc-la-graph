"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleCheck,
  CircleX,
  FileUp,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createProject,
  deleteProjectFile,
  getProjectBuild,
  listProjectFiles,
  listProjects,
  startProjectBuild,
  uploadProjectFiles,
  validateUploadSelection,
} from "@/lib/api";
import type { BuildSummary, Project, SnapshotFile } from "@/lib/contracts";
import { useAuth } from "./auth-provider";
import { ChatWorkspace } from "./chat-workspace";

const SELECTED_PROJECT_KEY = "graphify-selected-project-id";

export function ProjectWorkspace() {
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project>();
  const [chatProject, setChatProject] = useState<Project>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const rows = await listProjects();
      setProjects(rows);
      const target = selectId ?? localStorage.getItem(SELECTED_PROJECT_KEY);
      const selectedProject = target
        ? rows.find((row) => row.id === target)
        : undefined;
      if (target) setSelected(selectedProject);
      setError(undefined);
      return selectedProject;
    } catch {
      setError("Projects could not be loaded.");
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (chatProject) {
    return (
      <div className="h-dvh">
        <ChatWorkspace
          projectId={chatProject.id}
          projectName={chatProject.name}
          onBack={() => setChatProject(undefined)}
        />
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50">
      <header className="border-b bg-white px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Graphify projects</h1>
            <p className="text-sm text-slate-600">
              Shared evidence-grounded workspaces
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {auth.username}
            </span>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={auth.logout}
            >
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Projects</h2>
          {auth.roles.has("editor") && (
            <Button className="min-h-11" onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" /> New project
            </Button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-red-50 p-4 text-red-900"
          >
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center">
            <h3 className="font-semibold">No projects yet</h3>
            <p className="mt-1 text-sm text-slate-600">
              An editor can create the first shared project.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li
                key={project.id}
                className="rounded-xl border bg-white p-5 shadow-sm"
              >
                <button
                  className="min-h-11 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  onClick={() => {
                    localStorage.setItem(SELECTED_PROJECT_KEY, project.id);
                    setSelected(project);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{project.name}</h3>
                    <ProjectStateBadge state={project.state} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                    {project.description || "No description"}
                  </p>
                  <p className="mt-4 text-xs text-slate-500">
                    {project.activeDocumentCount} active documents
                  </p>
                </button>
                {project.allowedActions.createConversation && (
                  <Button
                    className="mt-4 min-h-11 w-full"
                    onClick={() => {
                      localStorage.setItem(SELECTED_PROJECT_KEY, project.id);
                      setChatProject(project);
                    }}
                  >
                    <MessageSquare className="mr-2 h-4 w-4" /> Start
                    conversation
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(creating || selected) && (
        <ProjectEditor
          project={selected}
          close={() => {
            setCreating(false);
            setSelected(undefined);
          }}
          changed={refresh}
        />
      )}
    </main>
  );
}

function ProjectEditor({
  project,
  close,
  changed,
}: {
  project?: Project;
  close: () => void;
  changed: (projectId: string) => Promise<Project | undefined>;
}) {
  const auth = useAuth();
  const [workingProject, setWorkingProject] = useState(project);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [files, setFiles] = useState<SnapshotFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [buildStatus, setBuildStatus] = useState<BuildSummary | undefined>(
    project?.currentBuild ?? project?.lastBuild ?? undefined,
  );
  const [activeBuildId, setActiveBuildId] = useState(project?.currentBuild?.id);
  const canEdit = auth.roles.has("editor");
  const buildInProgress =
    Boolean(activeBuildId) ||
    buildStatus?.status === "queued" ||
    buildStatus?.status === "building" ||
    workingProject?.state === "queued" ||
    workingProject?.state === "building";
  const workingProjectId = workingProject?.id;

  useEffect(() => {
    if (!project) return;
    setWorkingProject(project);
    setBuildStatus(project.currentBuild ?? project.lastBuild ?? undefined);
    setActiveBuildId(project.currentBuild?.id);
  }, [project]);

  useEffect(() => {
    if (workingProjectId)
      void listProjectFiles(workingProjectId)
        .then(setFiles)
        .catch(() => setFiles([]));
  }, [workingProjectId]);

  useEffect(() => {
    const projectId = workingProjectId;
    const buildId = activeBuildId;
    if (!projectId || !buildId) return;
    const polledProjectId: string = projectId;
    const polledBuildId: string = buildId;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const status = await getProjectBuild(polledProjectId, polledBuildId);
        if (cancelled) return;
        setBuildStatus(status);
        if (status.status === "queued" || status.status === "building") {
          timer = window.setTimeout(() => void poll(), 1000);
          return;
        }
        setActiveBuildId(undefined);
        if (status.status === "failed") {
          setError(buildFailureMessage(status.errorCode));
        }
        const refreshed = await changed(polledProjectId);
        if (!cancelled && refreshed) setWorkingProject(refreshed);
      } catch {
        if (cancelled) return;
        setError(
          "Build status could not be refreshed. Indexing may still be running.",
        );
        timer = window.setTimeout(() => void poll(), 2500);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeBuildId, changed, workingProjectId]);

  async function ensureProject() {
    if (workingProject) return workingProject;
    if (!name.trim()) throw new Error("Enter a project name.");
    const created = await createProject(name.trim(), description.trim());
    setWorkingProject(created);
    void changed(created.id);
    return created;
  }

  async function upload() {
    try {
      const validationError = validateUploadSelection(
        selectedFiles,
        auth.config.uploadLimits,
      );
      if (validationError) throw new Error(validationError);
      const target = await ensureProject();
      setError(undefined);
      const uploaded = await uploadProjectFiles(
        target.id,
        selectedFiles,
        (done, total) => setProgress(`Uploaded ${done} of ${total} files`),
      );
      setFiles(uploaded);
      setSelectedFiles([]);
      setProgress("Upload complete. Review the files, then build the project.");
      const refreshed = await changed(target.id);
      if (refreshed) setWorkingProject(refreshed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload failed.");
    }
  }

  async function build() {
    if (!workingProject || buildInProgress) return;
    try {
      setError(undefined);
      const buildId = await startProjectBuild(workingProject.id);
      const queued: BuildSummary = {
        id: buildId,
        status: "queued",
        errorCode: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };
      setProgress(undefined);
      setBuildStatus(queued);
      setActiveBuildId(buildId);
      setWorkingProject((current) =>
        current
          ? {
              ...current,
              state: "queued",
              currentBuild: queued,
              allowedActions: {
                ...current.allowedActions,
                build: false,
                editDraft: false,
              },
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The build failed.");
    }
  }

  async function removeFile(fileId: string) {
    if (!workingProject) return;
    try {
      await deleteProjectFile(workingProject.id, fileId);
      setFiles((current) => current.filter((file) => file.id !== fileId));
      const refreshed = await changed(workingProject.id);
      if (refreshed) setWorkingProject(refreshed);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The file could not be removed.",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-editor-title"
    >
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="project-editor-title" className="text-lg font-semibold">
            {workingProject ? workingProject.name : "Create project"}
          </h2>
          <Button variant="outline" className="min-h-11" onClick={close}>
            Close
          </Button>
        </div>
        {!workingProject && (
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium">
              Project name
              <input
                className="mt-1 min-h-11 w-full rounded-md border px-3"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Description
              <textarea
                className="mt-1 w-full rounded-md border p-3"
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
        )}
        {canEdit && (
          <div className="mt-6 rounded-lg border p-4">
            <label className="block font-medium" htmlFor="project-files">
              Select supported documents
            </label>
            <p className="mt-1 text-sm text-slate-600">
              Markdown, text, HTML, PDF, or DOCX. Maximum{" "}
              {Math.round(auth.config.uploadLimits.maxFileBytes / 1024 / 1024)}{" "}
              MiB each.
            </p>
            <input
              id="project-files"
              className="mt-3 min-h-11 w-full"
              type="file"
              multiple
              accept=".md,.txt,.html,.htm,.pdf,.docx"
              disabled={buildInProgress}
              onChange={(event) =>
                setSelectedFiles([...(event.target.files ?? [])])
              }
            />
            <Button
              className="mt-3 min-h-11"
              onClick={() => void upload()}
              disabled={!selectedFiles.length || buildInProgress}
            >
              <FileUp className="mr-2 h-4 w-4" /> Upload files
            </Button>
          </div>
        )}
        {workingProject && (
          <div className="mt-5">
            {files.length > 0 && (
              <>
                <h3 className="font-medium">Draft files</h3>
                <ul className="mt-2 max-h-48 divide-y overflow-auto rounded-lg border">
                  {files.map((file) => (
                    <li
                      className="flex min-w-0 items-center justify-between gap-3 p-3 text-sm"
                      key={file.id}
                    >
                      <span className="min-w-0 break-words">
                        {file.filename}{" "}
                        <span className="text-slate-500">
                          ({Math.ceil(file.size / 1024)} KiB)
                        </span>
                      </span>
                      {canEdit && (
                        <Button
                          variant="outline"
                          className="min-h-11 shrink-0"
                          disabled={buildInProgress}
                          onClick={() => void removeFile(file.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <BuildStatusPanel
              status={buildStatus}
              projectState={workingProject.state}
            />
            {canEdit && (
              <Button
                className="mt-4 min-h-11 w-full sm:w-auto"
                onClick={() => void build()}
                disabled={
                  buildInProgress ||
                  !workingProject.allowedActions.build ||
                  files.length === 0
                }
              >
                {buildInProgress ? (
                  <>
                    <LoaderCircle aria-hidden className="animate-spin" />
                    Indexing in progress
                  </>
                ) : (
                  "Build project"
                )}
              </Button>
            )}
          </div>
        )}
        {progress && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-900"
          >
            {progress}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ProjectStateBadge({ state }: { state: Project["state"] }) {
  const label = state === "building" ? "Indexing" : state;
  const colors =
    state === "ready"
      ? "bg-emerald-100 text-emerald-800"
      : state === "failed"
        ? "bg-red-100 text-red-800"
        : state === "queued" || state === "building"
          ? "bg-amber-100 text-amber-900"
          : "bg-slate-100 text-slate-700";
  return (
    <span
      aria-label={`Build status: ${label}`}
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${colors}`}
    >
      {label}
    </span>
  );
}

function BuildStatusPanel({
  status,
  projectState,
}: {
  status?: BuildSummary;
  projectState: Project["state"];
}) {
  const effectiveStatus =
    status?.status ??
    (projectState === "queued" ||
    projectState === "building" ||
    projectState === "ready" ||
    projectState === "failed"
      ? projectState
      : undefined);
  const content =
    effectiveStatus === "queued"
      ? {
          title: "Build queued",
          detail: "Waiting for the indexing worker to become available.",
          icon: (
            <LoaderCircle aria-hidden className="animate-spin text-amber-600" />
          ),
          tone: "border-amber-200 bg-amber-50 text-amber-950",
        }
      : effectiveStatus === "building"
        ? {
            title: "Indexing in progress",
            detail:
              "Extracting text, building the knowledge graph, and indexing evidence. This can take several minutes.",
            icon: (
              <LoaderCircle aria-hidden className="animate-spin text-sky-600" />
            ),
            tone: "border-sky-200 bg-sky-50 text-sky-950",
          }
        : effectiveStatus === "ready"
          ? {
              title: "Build ready",
              detail: "The knowledge graph and evidence index are available.",
              icon: <CircleCheck aria-hidden className="text-emerald-600" />,
              tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
            }
          : effectiveStatus === "failed"
            ? {
                title: "Build failed",
                detail: buildFailureMessage(status?.errorCode),
                icon: <CircleX aria-hidden className="text-red-600" />,
                tone: "border-red-200 bg-red-50 text-red-950",
              }
            : {
                title: "Not built yet",
                detail:
                  "Upload at least one valid document, then build the project.",
                icon: null,
                tone: "border-slate-200 bg-slate-50 text-slate-800",
              };
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-4 rounded-lg border p-4 ${content.tone}`}
    >
      <div className="flex items-center gap-2 font-semibold">
        {content.icon}
        <span>{content.title}</span>
      </div>
      <p className="mt-1 text-sm leading-5">{content.detail}</p>
    </div>
  );
}

function buildFailureMessage(errorCode: string | null | undefined) {
  const messages: Record<string, string> = {
    graphify_provider_authentication_failed:
      "The graph provider rejected its credential. Ask an administrator to verify the extraction-provider configuration, then retry.",
    graphify_provider_credential_missing:
      "The graph provider credential is missing. Ask an administrator to configure it, then retry.",
    graphify_provider_quota_or_rate_limit:
      "The graph provider is rate-limited or out of quota. Wait or update the provider account, then retry.",
    graphify_provider_timeout:
      "The graph provider timed out. Retry the build when the provider is responsive.",
    graphify_provider_connection_failed:
      "The graph provider could not be reached. Check its endpoint and network access, then retry.",
    graphify_provider_model_or_endpoint_not_found:
      "The configured graph model or endpoint was not found. Ask an administrator to verify the provider settings.",
    graphify_provider_base_url_invalid:
      "The configured graph provider URL is invalid. Ask an administrator to verify it.",
    source_invalid:
      "One or more documents could not be validated or converted. Review the uploaded files and retry.",
    limit_exceeded:
      "The documents exceeded a configured build limit. Reduce the project size and retry.",
  };
  return (
    messages[errorCode ?? ""] ??
    "The project could not be indexed. Review the documents and provider configuration, then retry."
  );
}
