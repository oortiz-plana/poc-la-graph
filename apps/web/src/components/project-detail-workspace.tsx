"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  File,
  FileUp,
  LoaderCircle,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { ApplicationShell } from "@/components/application-shell";
import { Button } from "@/components/ui/button";
import {
  addProjectMembers,
  cancelProjectAccessRequest,
  changeProjectMemberRole,
  decideProjectAccessRequest,
  deleteProjectFile,
  getProjectBuild,
  getProjectAccessContext,
  listProjectAccessActivity,
  listProjectAccessRequests,
  listProjectFiles,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  requestProjectAccess,
  searchDirectory,
  startProjectBuild,
  uploadProjectFiles,
  validateUploadSelection,
} from "@/lib/api";
import type {
  AccessActivity,
  AccessRequestContext,
  BuildSummary,
  DirectoryPrincipal,
  Project,
  ProjectAccessRequest,
  ProjectMembership,
  ProjectRole,
  SnapshotFile,
} from "@/lib/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "./auth-provider";
import { formatUpdatedAt, ProjectStateBadge } from "./project-workspace";

export type ProjectSection =
  "overview" | "documents" | "access" | "builds" | "settings";

type CandidateStatus = "selected" | "uploading" | "uploaded" | "failed";
type FileCandidate = {
  key: string;
  file: File;
  validation?: string;
  status: CandidateStatus;
};

export function ProjectDetailWorkspace({
  projectId,
  section,
}: {
  projectId: string;
  section: ProjectSection;
}) {
  const [project, setProject] = useState<Project>();
  const [accessContext, setAccessContext] = useState<AccessRequestContext>();
  const [files, setFiles] = useState<SnapshotFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [buildStatus, setBuildStatus] = useState<BuildSummary>();
  const [activeBuildId, setActiveBuildId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const projects = await listProjects();
      const match = projects.find((item) => item.id === projectId);
      if (!match) {
        const context = await getProjectAccessContext(projectId);
        if (context) {
          setAccessContext(context);
          setError(undefined);
        } else {
          setError(
            "This project could not be found or is no longer available.",
          );
        }
        return;
      }
      setProject(match);
      setAccessContext(undefined);
      setBuildStatus(match.currentBuild ?? match.lastBuild ?? undefined);
      setActiveBuildId(match.currentBuild?.id);
      try {
        setFiles(await listProjectFiles(projectId));
      } catch {
        setFiles([]);
      }
      setError(undefined);
    } catch {
      setError("The project workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeBuildId) return;
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const next = await getProjectBuild(projectId, activeBuildId!);
        if (cancelled) return;
        setBuildStatus(next);
        if (next.status === "queued" || next.status === "building") {
          timer = window.setTimeout(() => void poll(), 1000);
        } else {
          setActiveBuildId(undefined);
          await refresh();
        }
      } catch {
        if (!cancelled) {
          setError(
            "Build status could not be refreshed. The build may still be running.",
          );
          timer = window.setTimeout(() => void poll(), 2500);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeBuildId, projectId, refresh]);

  async function removeFile(fileId: string) {
    if (!project || !window.confirm("Remove this draft document?")) return;
    try {
      await deleteProjectFile(project.id, fileId);
      setFiles((current) => current.filter((file) => file.id !== fileId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document could not be removed.",
      );
    }
  }

  async function startBuild() {
    if (!project || activeBuildId) return;
    try {
      setError(undefined);
      const buildId = await startProjectBuild(project.id);
      setActiveBuildId(buildId);
      setBuildStatus({
        id: buildId,
        status: "queued",
        errorCode: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The build could not be started.",
      );
    }
  }

  if (loading) {
    return (
      <ApplicationShell>
        <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
          <p role="status" className="text-sm text-text-secondary">
            Loading project workspace…
          </p>
        </main>
      </ApplicationShell>
    );
  }

  if (!project) {
    if (accessContext) {
      return <AccessRequestScreen context={accessContext} />;
    }
    return (
      <ApplicationShell>
        <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
          <p
            role="alert"
            className="rounded-md border border-error-border bg-error-surface p-4 text-error"
          >
            {error ?? "Project unavailable."}
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center text-primary"
            href="/"
          >
            <ArrowLeft aria-hidden className="mr-2 h-4 w-4" /> Back to projects
          </Link>
        </main>
      </ApplicationShell>
    );
  }

  const canEdit = project.allowedActions.editDraft;
  const buildInProgress =
    Boolean(activeBuildId) ||
    buildStatus?.status === "queued" ||
    buildStatus?.status === "building";

  return (
    <ApplicationShell
      project={project}
      fileCount={files.length}
      section={section}
    >
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <header className="border-b pb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-words text-2xl font-semibold tracking-tight">
                  {project.name}
                </h1>
                <ProjectStateBadge state={project.state} />
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {project.description || "No project description provided."}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                Updated {formatUpdatedAt(project.updatedAt)} ·{" "}
                {project.activeDocumentCount} active documents
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/projects/${encodeURIComponent(project.id)}?section=documents`}
                className="inline-flex min-h-11 items-center justify-center rounded-md border bg-surface px-4 text-sm font-medium hover:bg-background"
              >
                Manage documents
              </Link>
              {project.allowedActions.createConversation && (
                <Link
                  href={`/projects/${encodeURIComponent(project.id)}/chat`}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Start conversation
                </Link>
              )}
              {canEdit && (
                <Button
                  variant={
                    project.allowedActions.createConversation
                      ? "outline"
                      : "default"
                  }
                  disabled={
                    buildInProgress ||
                    !project.allowedActions.build ||
                    files.length === 0
                  }
                  onClick={() => void startBuild()}
                >
                  {buildInProgress ? (
                    <LoaderCircle aria-hidden className="animate-spin" />
                  ) : (
                    <CircleCheck aria-hidden />
                  )}
                  {buildInProgress ? "Build in progress" : "Build knowledge"}
                </Button>
              )}
            </div>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-md border border-error-border bg-error-surface p-4 text-sm text-error"
          >
            {error}
          </p>
        )}

        <div className="py-6">
          {section === "overview" && (
            <Overview
              project={project}
              files={files}
              buildStatus={buildStatus}
            />
          )}
          {section === "documents" && (
            <DocumentsSection
              project={project}
              files={files}
              canEdit={canEdit}
              buildInProgress={buildInProgress}
              onFilesChanged={(next) => setFiles(next)}
              onRemove={(fileId) => void removeFile(fileId)}
            />
          )}
          {section === "access" && <AccessSection project={project} />}
          {section === "builds" && (
            <BuildsSection
              project={project}
              buildStatus={buildStatus}
              canBuild={
                canEdit &&
                !buildInProgress &&
                project.allowedActions.build &&
                files.length > 0
              }
              onBuild={() => void startBuild()}
            />
          )}
          {section === "settings" && <SettingsSection project={project} />}
        </div>
      </main>
    </ApplicationShell>
  );
}

function AccessRequestScreen({ context }: { context: AccessRequestContext }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState(context.status);
  const [requestId, setRequestId] = useState(context.requestId);
  const [error, setError] = useState<string>();

  async function submit() {
    try {
      const created = await requestProjectAccess(context.projectId, note);
      setStatus("pending");
      setRequestId(created.id);
      setError(undefined);
    } catch {
      setError("Your access request could not be sent.");
    }
  }

  async function cancel() {
    if (!requestId) return;
    try {
      await cancelProjectAccessRequest(context.projectId, requestId);
      setStatus("available");
      setRequestId(null);
      setError(undefined);
    } catch {
      setError("Your access request could not be cancelled.");
    }
  }

  return (
    <ApplicationShell>
      <main className="mx-auto grid min-h-[70vh] max-w-2xl place-items-center p-4 sm:p-6">
        <section
          className="w-full rounded-xl border bg-surface p-6 shadow-panel"
          aria-labelledby="private-project-heading"
        >
          <ShieldCheck aria-hidden className="h-8 w-8 text-primary" />
          <h1
            id="private-project-heading"
            className="mt-4 text-2xl font-semibold"
          >
            {context.projectName} is private
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            You are signed in to the correct organization, but this project has
            not been shared with you.
          </p>
          {status === "pending" ? (
            <div
              role="status"
              className="mt-6 rounded-md border border-information-border bg-information-surface p-4 text-information"
            >
              <p>
                Your request is pending review by a project Manager or Owner.
              </p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => void cancel()}
              >
                Cancel request
              </Button>
            </div>
          ) : (
            <>
              <label className="mt-6 block text-sm font-medium">
                Message to the project team{" "}
                <span className="font-normal text-text-muted">(optional)</span>
                <textarea
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-md border bg-background p-3"
                  placeholder="Explain why you need access"
                />
              </label>
              <Button className="mt-4" onClick={() => void submit()}>
                Request access
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-error">
              {error}
            </p>
          )}
          <Link
            className="mt-6 inline-flex min-h-11 items-center text-sm text-primary"
            href="/"
          >
            <ArrowLeft aria-hidden className="mr-2 h-4 w-4" /> Back to projects
          </Link>
        </section>
      </main>
    </ApplicationShell>
  );
}

function Overview({
  project,
  files,
  buildStatus,
}: {
  project: Project;
  files: SnapshotFile[];
  buildStatus?: BuildSummary;
}) {
  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="text-xl font-semibold">
        Project overview
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-text-secondary">
        A summary of source readiness and the active grounded-knowledge build.
      </p>
      <dl className="mt-6 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <Metric label="Draft documents" value={files.length.toString()} />
        <Metric
          label="Active documents"
          value={project.activeDocumentCount.toString()}
        />
        <Metric label="Latest build" value={buildStatusLabel(buildStatus)} />
      </dl>
      <div className="mt-8 border-t pt-6">
        <h3 className="text-lg font-semibold">Readiness</h3>
        <BuildStatusPanel status={buildStatus} projectState={project.state} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-5">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );
}

function DocumentsSection({
  project,
  files,
  canEdit,
  buildInProgress,
  onFilesChanged,
  onRemove,
}: {
  project: Project;
  files: SnapshotFile[];
  canEdit: boolean;
  buildInProgress: boolean;
  onFilesChanged: (files: SnapshotFile[]) => void;
  onRemove: (fileId: string) => void;
}) {
  const auth = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [candidates, setCandidates] = useState<FileCandidate[]>([]);
  const [uploadError, setUploadError] = useState<string>();
  const pendingFiles = candidates
    .filter((candidate) => candidate.status !== "uploaded")
    .map((candidate) => candidate.file);
  const selectionError = pendingFiles.length
    ? validateUploadSelection(pendingFiles, auth.config.uploadLimits)
    : undefined;

  function addFiles(incoming: File[]) {
    const current = candidates.filter(
      (candidate) => candidate.status !== "uploaded",
    );
    const combined = [
      ...current.map((candidate) => candidate.file),
      ...incoming,
    ];
    const names = new Set<string>();
    const next = combined.map((file, index) => {
      let validation = validateUploadSelection(
        [file],
        auth.config.uploadLimits,
      );
      if (!validation && names.has(file.name)) {
        validation = `Only one file named “${file.name}” can be uploaded at a time.`;
      }
      names.add(file.name);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        validation,
        status: "selected" as const,
      };
    });
    setCandidates(next);
    setUploadError(undefined);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!canEdit || buildInProgress) return;
    addFiles([...event.dataTransfer.files]);
  }

  async function upload() {
    const valid = candidates.filter((candidate) => !candidate.validation);
    if (!valid.length || selectionError || buildInProgress) return;
    setUploadError(undefined);
    setCandidates((current) =>
      current.map((candidate, index) => ({
        ...candidate,
        status: index === 0 ? "uploading" : "selected",
      })),
    );
    try {
      const uploaded = await uploadProjectFiles(
        project.id,
        valid.map((candidate) => candidate.file),
        (completed) => {
          setCandidates((current) =>
            current.map((candidate, index) => ({
              ...candidate,
              status:
                index < completed
                  ? "uploaded"
                  : index === completed
                    ? "uploading"
                    : candidate.status,
            })),
          );
        },
      );
      setCandidates((current) =>
        current.map((candidate) => ({ ...candidate, status: "uploaded" })),
      );
      onFilesChanged(uploaded);
    } catch (cause) {
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.status === "uploading"
            ? { ...candidate, status: "failed" }
            : candidate,
        ),
      );
      setUploadError(
        cause instanceof Error ? cause.message : "The upload failed.",
      );
    }
  }

  return (
    <section aria-labelledby="documents-heading">
      <h2 id="documents-heading" className="text-xl font-semibold">
        Documents
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-text-secondary">
        Add validated source files to the draft snapshot before building the
        project knowledge graph and passage index.
      </p>

      {canEdit && (
        <div
          id="upload-files"
          data-testid="upload-zone"
          onDragEnter={(event) => {
            event.preventDefault();
            if (!buildInProgress) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={drop}
          className={`mt-6 rounded-lg border-2 border-dashed p-6 text-center ${
            dragging ? "border-primary bg-selected" : "border-border bg-surface"
          }`}
        >
          <FileUp aria-hidden className="mx-auto h-8 w-8 text-primary" />
          <h3 className="mt-3 font-semibold">Drop documents here</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Markdown, TXT, HTML, PDF, and DOCX · Maximum{" "}
            {formatBytes(auth.config.uploadLimits.maxFileBytes)} per file · Up
            to {auth.config.uploadLimits.maxFiles} files
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Files must be non-empty, uniquely named, and use a valid normalized
            filename. PDF OCR is not supported.
          </p>
          <input
            ref={input}
            id="project-document-picker"
            type="file"
            multiple
            accept=".md,.txt,.html,.htm,.pdf,.docx"
            className="sr-only"
            disabled={buildInProgress}
            onChange={(event) => addFiles([...(event.target.files ?? [])])}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            disabled={buildInProgress}
            onClick={() => input.current?.click()}
          >
            Select files
          </Button>
          {buildInProgress && (
            <p className="mt-3 text-sm text-warning">
              Uploads are unavailable while knowledge indexing is in progress.
            </p>
          )}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mt-6 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Selected files</h3>
            <Button
              disabled={
                buildInProgress ||
                Boolean(selectionError) ||
                !candidates.some((candidate) => !candidate.validation)
              }
              onClick={() => void upload()}
            >
              Upload valid files
            </Button>
          </div>
          <ul className="mt-3 divide-y rounded-lg border bg-surface">
            {candidates.map((candidate) => (
              <li
                key={candidate.key}
                className="flex flex-wrap items-center gap-3 p-3 text-sm"
              >
                <File aria-hidden className="h-5 w-5 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">
                    {candidate.file.name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(candidate.file.size)}
                  </p>
                  {candidate.validation && (
                    <p className="mt-1 text-xs text-error">
                      {candidate.validation}
                    </p>
                  )}
                </div>
                <CandidateStatus candidate={candidate} />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${candidate.file.name} from selection`}
                  disabled={candidate.status === "uploading"}
                  onClick={() =>
                    setCandidates((current) =>
                      current.filter((item) => item.key !== candidate.key),
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
                {candidate.status === "uploading" && (
                  <div className="basis-full" aria-label="Upload progress">
                    <div className="h-1.5 overflow-hidden rounded-full bg-border">
                      <div className="h-full w-1/2 animate-pulse bg-primary" />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {(selectionError || uploadError) && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-error-border bg-error-surface p-3 text-sm text-error"
            >
              {uploadError ?? selectionError}
            </p>
          )}
        </div>
      )}

      <div className="mt-8 border-t pt-6">
        <h3 className="text-lg font-semibold">Project documents</h3>
        {files.length ? (
          <div className="mt-3 overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b bg-background text-xs text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {files.map((file) => (
                  <tr key={file.id}>
                    <td className="break-words px-4 py-3 font-medium">
                      {file.filename}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {file.mediaType}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatBytes(file.size)}
                    </td>
                    <td className="px-4 py-3">
                      <DocumentStatus state={project.state} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${file.filename}`}
                          disabled={buildInProgress}
                          onClick={() => onRemove(file.id)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
            No documents have been added to this project draft.
          </p>
        )}
      </div>
    </section>
  );
}

function CandidateStatus({ candidate }: { candidate: FileCandidate }) {
  if (candidate.validation) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-error">
        <CircleAlert aria-hidden className="h-4 w-4" /> Invalid
        <span className="sr-only">: {candidate.validation}</span>
      </span>
    );
  }
  const labels: Record<CandidateStatus, string> = {
    selected: "Valid",
    uploading: "Uploading…",
    uploaded: "Uploaded",
    failed: "Upload failed",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        candidate.status === "failed"
          ? "text-error"
          : candidate.status === "uploading"
            ? "text-information"
            : "text-success"
      }`}
    >
      {candidate.status === "uploading" ? (
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
      ) : candidate.status === "failed" ? (
        <CircleAlert aria-hidden className="h-4 w-4" />
      ) : (
        <CircleCheck aria-hidden className="h-4 w-4" />
      )}
      {labels[candidate.status]}
    </span>
  );
}

function DocumentStatus({ state }: { state: Project["state"] }) {
  const status =
    state === "queued" || state === "building"
      ? "Processing"
      : state === "ready"
        ? "Ready"
        : state === "failed"
          ? "Failed"
          : state === "archived"
            ? "Superseded"
            : "Draft";
  const tone =
    status === "Ready"
      ? "border-success-border bg-success-surface text-success"
      : status === "Processing"
        ? "border-information-border bg-information-surface text-information"
        : status === "Failed"
          ? "border-error-border bg-error-surface text-error"
          : status === "Superseded"
            ? "border-warning-border bg-warning-surface text-warning"
            : "border-border bg-background text-text-secondary";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${tone}`}
    >
      {status === "Processing" && (
        <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
      )}
      {status}
    </span>
  );
}

function AccessSection({ project }: { project: Project }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"members" | "requests" | "activity">(
    "members",
  );
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [requests, setRequests] = useState<ProjectAccessRequest[]>([]);
  const [activity, setActivity] = useState<AccessActivity[]>([]);
  const [error, setError] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<
    DirectoryPrincipal[]
  >([]);
  const [selected, setSelected] = useState<DirectoryPrincipal[]>([]);
  const [newRole, setNewRole] =
    useState<Exclude<ProjectRole, "owner">>("viewer");
  const [approvalRoles, setApprovalRoles] = useState<
    Record<string, Exclude<ProjectRole, "owner">>
  >({});

  const load = useCallback(async () => {
    try {
      const [nextMembers, nextRequests, nextActivity] = await Promise.all([
        listProjectMembers(project.id),
        project.allowedActions.manageAccess
          ? listProjectAccessRequests(project.id)
          : Promise.resolve([]),
        project.allowedActions.viewAccessActivity
          ? listProjectAccessActivity(project.id)
          : Promise.resolve([]),
      ]);
      setMembers(nextMembers);
      setRequests(nextRequests);
      setActivity(nextActivity);
      setError(undefined);
    } catch {
      setError("Access information could not be loaded.");
    }
  }, [project]);

  useEffect(() => void load(), [load]);

  const visible = members.filter((member) =>
    `${member.displayName} ${member.role} ${member.accessOrigin}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  async function findDirectory() {
    try {
      setDirectoryResults(await searchDirectory(project.id, directoryQuery));
      setError(undefined);
    } catch {
      setError("The company directory could not be searched.");
    }
  }

  async function grantAccess() {
    if (!selected.length) return;
    try {
      setMembers(await addProjectMembers(project.id, selected, newRole));
      setAddOpen(false);
      setSelected([]);
      setDirectoryQuery("");
      setDirectoryResults([]);
      setError(undefined);
      await load();
    } catch {
      setError("Project access could not be granted.");
    }
  }

  async function changeRole(member: ProjectMembership, role: ProjectRole) {
    if (
      (member.role === "owner" || role === "owner") &&
      !window.confirm(`Change ${member.displayName} to ${role}?`)
    )
      return;
    try {
      const updated = await changeProjectMemberRole(
        project.id,
        member.id,
        role,
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      setError(
        "The role could not be changed. A project must retain an Owner.",
      );
    }
  }

  async function removeMember(member: ProjectMembership) {
    if (!window.confirm(`Remove access for ${member.displayName}?`)) return;
    try {
      await removeProjectMember(project.id, member.id);
      setMembers((current) => current.filter((item) => item.id !== member.id));
    } catch {
      setError("Access could not be removed. A project must retain an Owner.");
    }
  }

  async function decide(request: ProjectAccessRequest, approved: boolean) {
    try {
      await decideProjectAccessRequest(
        project.id,
        request.id,
        approved ? "approved" : "denied",
        approved ? (approvalRoles[request.id] ?? "viewer") : undefined,
      );
      await load();
    } catch {
      setError("The access request could not be updated.");
    }
  }

  return (
    <section aria-labelledby="access-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="access-heading" className="text-xl font-semibold">
            Access & sharing
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-text-secondary">
            This project is private. Access is granted to provisioned directory
            users and groups and every change is audited.
          </p>
        </div>
        {project.allowedActions.manageAccess && (
          <Button onClick={() => setAddOpen(true)}>
            <Users aria-hidden /> Add people or groups
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-error-border bg-error-surface p-3 text-sm text-error"
        >
          {error}
        </p>
      )}

      <div
        className="mt-6 flex gap-1 border-b"
        role="tablist"
        aria-label="Access views"
      >
        {(["members", "requests", "activity"] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={view === item}
            className={`min-h-11 border-b-2 px-4 text-sm font-medium capitalize ${view === item ? "border-primary text-primary" : "border-transparent text-text-secondary"}`}
            onClick={() => setView(item)}
          >
            {item}
            {item === "requests" &&
            requests.filter((request) => request.status === "pending").length >
              0
              ? ` (${requests.filter((request) => request.status === "pending").length})`
              : ""}
          </button>
        ))}
      </div>

      {view === "members" && (
        <>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search members</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users or groups"
                className="min-h-11 w-full rounded-md border bg-surface py-2 pl-9 pr-3 text-sm"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Effective access uses the highest direct or group role: Owner,
            Manager, Contributor, or Viewer.
          </p>
          <div className="mt-6 hidden overflow-x-auto rounded-lg border bg-surface sm:block">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="border-b bg-background text-xs text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Access origin</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3 font-medium">
                      {member.displayName}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${member.displayName}`}
                        value={member.role}
                        disabled={!project.allowedActions.manageAccess}
                        onChange={(event) =>
                          void changeRole(
                            member,
                            event.target.value as ProjectRole,
                          )
                        }
                        className="min-h-11 rounded-md border bg-background px-3"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="contributor">Contributor</option>
                        <option value="manager">Manager</option>
                        {member.principalType === "user" &&
                          project.currentAccess.effectiveRole === "owner" && (
                            <option value="owner">Owner</option>
                          )}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {member.accessOrigin === "group"
                        ? "Directory group"
                        : "Direct"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-success">
                        <CircleCheck aria-hidden className="h-4 w-4" /> Active
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!project.allowedActions.manageAccess}
                          aria-label={`Remove access for ${member.displayName}`}
                          onClick={() => void removeMember(member)}
                          className="text-error"
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-text-secondary"
                    >
                      No members match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 space-y-3 sm:hidden">
            {visible.map((member) => (
              <li key={member.id} className="rounded-lg border bg-surface p-4">
                <p className="font-medium">{member.displayName}</p>
                <p className="mt-1 text-sm capitalize text-text-secondary">
                  {member.role} ·{" "}
                  {member.accessOrigin === "group"
                    ? "Directory group"
                    : "Direct access"}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex gap-3 rounded-md border border-information-border bg-information-surface p-4 text-sm text-information">
            <ShieldCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Owner protection</p>
              <p className="mt-1">
                A project must always retain at least one Owner. The final Owner
                cannot be removed or assigned a lower role. Removing access will
                require confirmation when member management is enabled.
              </p>
            </div>
          </div>
        </>
      )}

      {view === "requests" && (
        <div className="mt-6">
          {requests.length ? (
            <ul className="space-y-3">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{request.requesterName}</p>
                    <p className="text-sm text-text-secondary">
                      {request.note || "No note provided"} ·{" "}
                      <span className="capitalize">{request.status}</span>
                    </p>
                  </div>
                  {request.status === "pending" &&
                    project.allowedActions.manageAccess && (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`request-role-${request.id}`}
                        >
                          Role for {request.requesterName}
                        </label>
                        <select
                          id={`request-role-${request.id}`}
                          value={approvalRoles[request.id] ?? "viewer"}
                          onChange={(event) =>
                            setApprovalRoles((current) => ({
                              ...current,
                              [request.id]: event.target.value as Exclude<
                                ProjectRole,
                                "owner"
                              >,
                            }))
                          }
                          className="min-h-11 rounded-md border bg-background px-3 text-sm"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="contributor">Contributor</option>
                          <option value="manager">Manager</option>
                        </select>
                        <Button
                          size="sm"
                          onClick={() => void decide(request, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void decide(request, false)}
                        >
                          Deny
                        </Button>
                      </>
                    )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-text-secondary">
              No access requests.
            </p>
          )}
        </div>
      )}

      {view === "activity" && (
        <div className="mt-6">
          {project.allowedActions.viewAccessActivity ? (
            activity.length ? (
              <ol className="space-y-3">
                {activity.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-lg border bg-surface p-4 text-sm"
                  >
                    <p className="font-medium">
                      {event.action.replaceAll(".", " ")}
                    </p>
                    <p className="mt-1 text-text-secondary">
                      {event.targetName || "Project access"} ·{" "}
                      {formatUpdatedAt(event.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-sm text-text-secondary">
                No access changes recorded yet.
              </p>
            )
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-text-secondary">
              Access activity is available to Managers and Owners.
            </p>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add people or groups</DialogTitle>
            <DialogDescription>
              Search identities already provisioned in your company directory.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Directory search</span>
              <input
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-3"
                placeholder="Name, email, or group"
              />
            </label>
            <Button variant="outline" onClick={() => void findDirectory()}>
              <Search aria-hidden /> Search
            </Button>
          </div>
          <ul className="max-h-52 overflow-y-auto rounded-md border">
            {directoryResults.map((item) => {
              const active = selected.some(
                (entry) => entry.id === item.id && entry.type === item.type,
              );
              return (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    type="button"
                    className={`flex min-h-11 w-full items-center gap-3 px-3 text-left ${active ? "bg-selected" : "hover:bg-background"}`}
                    aria-pressed={active}
                    onClick={() =>
                      setSelected((current) =>
                        active
                          ? current.filter(
                              (entry) =>
                                !(
                                  entry.id === item.id &&
                                  entry.type === item.type
                                ),
                            )
                          : [...current, item],
                      )
                    }
                  >
                    <Users aria-hidden className="h-4 w-4" />
                    <span className="flex-1">
                      <span className="block font-medium">
                        {item.displayName}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {item.secondaryText || item.type}
                      </span>
                    </span>
                    {active && (
                      <CircleCheck
                        aria-hidden
                        className="h-4 w-4 text-success"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="text-sm font-medium">
            Project role
            <select
              value={newRole}
              onChange={(event) =>
                setNewRole(event.target.value as Exclude<ProjectRole, "owner">)
              }
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
            >
              <option value="viewer">Viewer · read and chat</option>
              <option value="contributor">
                Contributor · upload and build
              </option>
              <option value="manager">Manager · manage access</option>
            </select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selected.length}
              onClick={() => void grantAccess()}
            >
              Grant access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BuildsSection({
  project,
  buildStatus,
  canBuild,
  onBuild,
}: {
  project: Project;
  buildStatus?: BuildSummary;
  canBuild: boolean;
  onBuild: () => void;
}) {
  return (
    <section aria-labelledby="builds-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="builds-heading" className="text-xl font-semibold">
            Knowledge builds
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-text-secondary">
            Track validation, conversion, passage indexing, and graph
            extraction.
          </p>
        </div>
        <Button disabled={!canBuild} onClick={onBuild}>
          Build knowledge
        </Button>
      </div>
      <BuildStatusPanel status={buildStatus} projectState={project.state} />
      <div className="mt-8 border-t pt-6">
        <h3 className="text-lg font-semibold">Build history</h3>
        {buildStatus ? (
          <dl className="mt-3 grid gap-4 rounded-lg border bg-surface p-4 sm:grid-cols-3">
            <Metric label="Status" value={buildStatusLabel(buildStatus)} />
            <Metric label="Created" value={formatDate(buildStatus.createdAt)} />
            <Metric
              label="Completed"
              value={
                buildStatus.completedAt
                  ? formatDate(buildStatus.completedAt)
                  : "Not completed"
              }
            />
          </dl>
        ) : (
          <p className="mt-3 text-sm text-text-secondary">
            No builds have run yet.
          </p>
        )}
      </div>
    </section>
  );
}

function SettingsSection({ project }: { project: Project }) {
  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading" className="text-xl font-semibold">
        Settings
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-text-secondary">
        Project configuration will live here as server-supported settings are
        introduced.
      </p>
      <dl className="mt-6 max-w-3xl divide-y rounded-lg border bg-surface px-4">
        <div className="py-4">
          <dt className="text-sm font-medium">Project name</dt>
          <dd className="mt-1 text-sm text-text-secondary">{project.name}</dd>
        </div>
        <div className="py-4">
          <dt className="text-sm font-medium">Knowledge behavior</dt>
          <dd className="mt-1 text-sm text-text-secondary">
            Graph-first retrieval with source-passage grounding.
          </dd>
        </div>
      </dl>
    </section>
  );
}

function BuildStatusPanel({
  status,
  projectState,
}: {
  status?: BuildSummary;
  projectState: Project["state"];
}) {
  const effective = status?.status ?? projectState;
  const content =
    effective === "queued"
      ? {
          title: "Build queued",
          detail: "Waiting for the indexing worker to become available.",
          tone: "border-warning-border bg-warning-surface text-warning",
        }
      : effective === "building"
        ? {
            title: "Indexing in progress",
            detail:
              "Validating documents, extracting text, building the knowledge graph, and indexing source passages.",
            tone: "border-information-border bg-information-surface text-information",
          }
        : effective === "ready"
          ? {
              title: "Build ready",
              detail: "The knowledge graph and evidence index are available.",
              tone: "border-success-border bg-success-surface text-success",
            }
          : effective === "failed"
            ? {
                title: "Build failed",
                detail: buildFailureMessage(status?.errorCode),
                tone: "border-error-border bg-error-surface text-error",
              }
            : {
                title: "Not built yet",
                detail:
                  "Upload at least one valid document, then build the project.",
                tone: "border-border bg-background text-text-secondary",
              };
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-4 rounded-lg border p-4 ${content.tone}`}
    >
      <p className="flex items-center gap-2 font-semibold">
        {(effective === "queued" || effective === "building") && (
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        )}
        {effective === "ready" && (
          <CircleCheck aria-hidden className="h-4 w-4" />
        )}
        {effective === "failed" && (
          <CircleAlert aria-hidden className="h-4 w-4" />
        )}
        {content.title}
      </p>
      <p className="mt-1 text-sm leading-5">{content.detail}</p>
    </div>
  );
}

function buildStatusLabel(status?: BuildSummary) {
  if (!status) return "Not built";
  return status.status === "building" ? "Indexing" : capitalize(status.status);
}

function buildFailureMessage(errorCode: string | null | undefined) {
  if (errorCode === "source_invalid")
    return "One or more documents could not be validated or converted. Review the documents and retry.";
  if (errorCode === "limit_exceeded")
    return "The documents exceeded a configured build limit. Reduce the project size and retry.";
  return "The project could not be indexed. Review the documents and provider configuration, then retry.";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
