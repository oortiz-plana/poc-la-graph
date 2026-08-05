"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleX,
  FolderKanban,
  LoaderCircle,
  MessageSquare,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApplicationShell } from "@/components/application-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createProject, listProjects } from "@/lib/api";
import type { Project } from "@/lib/contracts";
import { useAuth } from "./auth-provider";

export function ProjectWorkspace() {
  const auth = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setError(undefined);
    } catch {
      setError("Projects could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ApplicationShell>
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 id="projects" className="text-2xl font-semibold tracking-tight">
              Projects
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Open a grounded research workspace or manage its source documents.
            </p>
          </div>
          {auth.roles.has("editor") && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New project
            </Button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-error-border bg-error-surface p-4 text-sm text-error"
          >
            {error}
          </p>
        )}
        {loading ? (
          <ProjectSkeleton />
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-surface p-8 text-center">
            <h2 className="font-semibold">No projects yet</h2>
            <p className="mt-1 text-sm text-text-secondary">
              An editor can create the first shared project.
            </p>
          </div>
        ) : (
          <ul className="project-grid grid gap-4">
            {projects.map((project) => {
              const destination = projectSectionHref(project);
              return (
                <li
                  key={project.id}
                  className="flex min-w-0 flex-col rounded-lg border bg-surface p-5 shadow-panel"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="break-words text-base font-semibold">
                      {project.name}
                    </h2>
                    <ProjectStateBadge state={project.state} />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-text-secondary">
                    {project.description || "No description provided."}
                  </p>
                  <p className="mt-4 text-xs text-text-muted">
                    {project.activeDocumentCount} active documents · Updated{" "}
                    {formatUpdatedAt(project.updatedAt)}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    <Link
                      href={destination}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {project.state === "ready" ? (
                        <MessageSquare aria-hidden className="h-4 w-4" />
                      ) : (
                        <FolderKanban aria-hidden className="h-4 w-4" />
                      )}
                      {projectActionLabel(project)}
                    </Link>
                    <Link
                      href={`/projects/${encodeURIComponent(project.id)}`}
                      className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Project details
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      {creating && (
        <CreateProjectDialog
          close={() => setCreating(false)}
          created={(project) => {
            setCreating(false);
            router.push(
              `/projects/${encodeURIComponent(project.id)}?section=documents`,
            );
          }}
        />
      )}
    </ApplicationShell>
  );
}

function CreateProjectDialog({
  close,
  created,
}: {
  close: () => void;
  created: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      created(await createProject(name.trim(), description.trim()));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The project could not be created.",
      );
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Add the project basics. Documents and build configuration continue
            in the project workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm font-medium">
            Project name
            <input
              autoFocus
              required
              className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Description
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border bg-surface p-3"
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-error-border bg-error-surface p-3 text-sm text-error"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Creating project…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectSkeleton() {
  return (
    <div role="status" aria-label="Loading projects">
      <span className="sr-only">Loading projects…</span>
      <div aria-hidden className="project-grid grid gap-4">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-56 animate-pulse rounded-lg border bg-surface p-5"
          >
            <div className="h-4 w-2/3 rounded bg-border" />
            <div className="mt-5 h-3 w-full rounded bg-border/70" />
            <div className="mt-2 h-3 w-4/5 rounded bg-border/70" />
            <div className="mt-16 h-11 w-36 rounded bg-selected" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectStateBadge({ state }: { state: Project["state"] }) {
  const label = state === "building" ? "Indexing" : state;
  const colors =
    state === "ready"
      ? "border-success-border bg-success-surface text-success"
      : state === "failed"
        ? "border-error-border bg-error-surface text-error"
        : state === "queued" || state === "building"
          ? "border-warning-border bg-warning-surface text-warning"
          : "border-border bg-background text-text-secondary";
  return (
    <span
      aria-label={`Build status: ${label}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${colors}`}
    >
      {state === "ready" ? (
        <CircleCheck aria-hidden className="h-3.5 w-3.5" />
      ) : state === "failed" ? (
        <CircleX aria-hidden className="h-3.5 w-3.5" />
      ) : state === "queued" || state === "building" ? (
        <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : null}
      {label}
    </span>
  );
}

function projectSectionHref(project: Project) {
  const section =
    project.state === "draft"
      ? "documents"
      : project.state === "queued" ||
          project.state === "building" ||
          project.state === "failed"
        ? "builds"
        : "overview";
  return `/projects/${encodeURIComponent(project.id)}?section=${section}`;
}

function projectActionLabel(project: Project) {
  if (project.state === "ready") return "Open project";
  if (project.state === "draft") return "Continue setup";
  if (project.state === "queued" || project.state === "building")
    return "View progress";
  if (project.state === "failed") return "Review error";
  return "View project";
}

export function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";
  const elapsedMinutes = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 60_000),
  );
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.round(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
