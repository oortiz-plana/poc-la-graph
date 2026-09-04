"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  CircleCheck,
  CircleX,
  Clock3,
  Ellipsis,
  FileText,
  FolderKanban,
  LoaderCircle,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createProject, listProjects } from "@/lib/api";
import type { Project } from "@/lib/contracts";
import { useAuth } from "./auth-provider";

export function ProjectWorkspace() {
  return (
    <Suspense fallback={<ProjectWorkspaceFallback />}>
      <ProjectWorkspaceContent />
    </Suspense>
  );
}

type ProjectFilter = "all" | "ready" | "setup" | "attention";
type ProjectSort = "updated" | "name" | "documents";

const projectFilters: { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "setup", label: "Setup" },
  { value: "attention", label: "Attention" },
];

function parseProjectFilter(value: string | null): ProjectFilter {
  return value === "ready" || value === "setup" || value === "attention"
    ? value
    : "all";
}

function parseProjectSort(value: string | null): ProjectSort {
  return value === "name" || value === "documents" ? value : "updated";
}

function projectMatchesFilter(project: Project, filter: ProjectFilter) {
  if (filter === "ready") return project.state === "ready";
  if (filter === "setup")
    return (
      project.state === "draft" ||
      project.state === "queued" ||
      project.state === "building"
    );
  if (filter === "attention") return project.state === "failed";
  return true;
}

function projectFilterCounts(
  projects: Project[],
): Record<ProjectFilter, number> {
  return {
    all: projects.length,
    ready: projects.filter((project) => projectMatchesFilter(project, "ready"))
      .length,
    setup: projects.filter((project) => projectMatchesFilter(project, "setup"))
      .length,
    attention: projects.filter((project) =>
      projectMatchesFilter(project, "attention"),
    ).length,
  };
}

function filterAndSortProjects(
  projects: Project[],
  query: string,
  filter: ProjectFilter,
  sort: ProjectSort,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return projects
    .filter((project) => {
      const searchable = `${project.name} ${project.description ?? ""}`
        .toLocaleLowerCase()
        .trim();
      return (
        projectMatchesFilter(project, filter) &&
        (!normalizedQuery || searchable.includes(normalizedQuery))
      );
    })
    .sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "documents") {
        return (
          right.activeDocumentCount - left.activeDocumentCount ||
          left.name.localeCompare(right.name)
        );
      }
      const leftTimestamp = Date.parse(left.updatedAt);
      const rightTimestamp = Date.parse(right.updatedAt);
      return (
        (Number.isFinite(rightTimestamp) ? rightTimestamp : 0) -
          (Number.isFinite(leftTimestamp) ? leftTimestamp : 0) ||
        left.name.localeCompare(right.name)
      );
    });
}

function setOrDelete(params: URLSearchParams, name: string, value: string) {
  if (value) params.set(name, value);
  else params.delete(name);
}

function ProjectWorkspaceContent() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [filter, setFilter] = useState<ProjectFilter>(() =>
    parseProjectFilter(searchParams.get("status")),
  );
  const [sort, setSort] = useState<ProjectSort>(() =>
    parseProjectSort(searchParams.get("sort")),
  );

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

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setFilter(parseProjectFilter(searchParams.get("status")));
    setSort(parseProjectSort(searchParams.get("sort")));
  }, [searchParams]);

  const counts = useMemo(() => projectFilterCounts(projects), [projects]);
  const visibleProjects = useMemo(
    () => filterAndSortProjects(projects, query, filter, sort),
    [filter, projects, query, sort],
  );

  const updateUrl = useCallback(
    (next: { query?: string; filter?: ProjectFilter; sort?: ProjectSort }) => {
      const nextQuery = next.query ?? query;
      const nextFilter = next.filter ?? filter;
      const nextSort = next.sort ?? sort;
      const params = new URLSearchParams(window.location.search);

      setOrDelete(params, "q", nextQuery.trim());
      setOrDelete(params, "status", nextFilter === "all" ? "" : nextFilter);
      setOrDelete(params, "sort", nextSort === "updated" ? "" : nextSort);

      const suffix = params.toString();
      window.history.replaceState(
        null,
        "",
        suffix ? `${pathname}?${suffix}` : pathname,
      );
    },
    [filter, pathname, query, sort],
  );

  function clearFilters() {
    setQuery("");
    setFilter("all");
    setSort("updated");
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("status");
    params.delete("sort");
    const suffix = params.toString();
    window.history.replaceState(
      null,
      "",
      suffix ? `${pathname}?${suffix}` : pathname,
    );
  }

  return (
    <ApplicationShell>
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1
                id="projects"
                className="text-2xl font-semibold tracking-tight"
              >
                Projects
              </h1>
              {!loading && !error && (
                <span className="rounded-full border bg-surface px-2.5 py-0.5 text-sm font-medium text-text-secondary">
                  {projects.length}
                </span>
              )}
            </div>
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
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error-border bg-error-surface p-4 text-sm text-error"
          >
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={() => {
                setError(undefined);
                setLoading(true);
                void refresh();
              }}
            >
              <RotateCw aria-hidden /> Retry
            </Button>
          </div>
        )}
        {error ? null : loading ? (
          <ProjectSkeleton />
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-surface p-8 text-center">
            <h2 className="font-semibold">No projects yet</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {auth.roles.has("editor")
                ? "Create the first shared project to begin research."
                : "An editor can create the first shared project."}
            </p>
          </div>
        ) : (
          <>
            <ProjectToolbar
              counts={counts}
              filter={filter}
              query={query}
              sort={sort}
              onFilterChange={(value) => {
                setFilter(value);
                updateUrl({ filter: value });
              }}
              onQueryChange={(value) => {
                setQuery(value);
                updateUrl({ query: value });
              }}
              onSortChange={(value) => {
                setSort(value);
                updateUrl({ sort: value });
              }}
            />
            <div className="mb-3 flex items-center justify-between gap-3 text-sm text-text-muted">
              <p role="status">
                Showing {visibleProjects.length} of {projects.length} projects
              </p>
            </div>
            {visibleProjects.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-surface p-8 text-center">
                <h2 className="font-semibold">No matching projects</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Try another search or clear the current filters.
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            )}
          </>
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

function ProjectToolbar({
  counts,
  filter,
  query,
  sort,
  onFilterChange,
  onQueryChange,
  onSortChange,
}: {
  counts: Record<ProjectFilter, number>;
  filter: ProjectFilter;
  query: string;
  sort: ProjectSort;
  onFilterChange: (value: ProjectFilter) => void;
  onQueryChange: (value: string) => void;
  onSortChange: (value: ProjectSort) => void;
}) {
  return (
    <section aria-label="Project filters" className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full lg:max-w-md">
          <span className="sr-only">Search projects</span>
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search projects"
            className="min-h-11 w-full rounded-md border bg-surface py-2 pl-10 pr-3 text-sm placeholder:text-text-muted"
          />
        </label>
        <label className="relative flex min-h-11 items-center gap-2 rounded-md border bg-surface px-3 text-sm font-medium">
          <ArrowUpDown aria-hidden className="h-4 w-4 text-text-muted" />
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            aria-label="Sort projects"
            value={sort}
            onChange={(event) =>
              onSortChange(event.target.value as ProjectSort)
            }
            className="min-h-10 bg-transparent pr-1 outline-none"
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
            <option value="documents">Document count</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Status">
        {projectFilters.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => onFilterChange(item.value)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
              filter === item.value
                ? "border-primary bg-selected text-primary"
                : "bg-surface text-text-secondary hover:bg-background"
            }`}
          >
            {item.label}
            <span className="text-xs tabular-nums">{counts[item.value]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const destination = projectSectionHref(project);
  const projectHref = `/projects/${encodeURIComponent(project.id)}`;
  const emphasis =
    project.state === "failed"
      ? "border-error-border"
      : project.state === "queued" || project.state === "building"
        ? "border-warning-border"
        : "border-border";

  return (
    <li
      className={`flex min-w-0 flex-col rounded-lg border bg-surface p-5 shadow-panel ${emphasis}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={projectHref}
            className="break-words text-base font-semibold hover:text-primary hover:underline focus-visible:rounded-sm"
          >
            {project.name}
          </Link>
        </div>
        <ProjectStateBadge state={project.state} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-2"
              aria-label={`Actions for ${project.name}`}
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={projectHref}>
                <Settings aria-hidden /> Project details
              </Link>
            </DropdownMenuItem>
            {project.allowedActions.manageAccess && (
              <DropdownMenuItem asChild>
                <Link href={`${projectHref}?section=access`}>
                  <Users aria-hidden /> Manage access
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {project.description && (
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-text-secondary">
          {project.description}
        </p>
      )}
      <div className="mt-5 space-y-2 text-sm text-text-muted">
        <p className="flex items-center gap-2">
          <FileText aria-hidden className="h-4 w-4" />
          {project.activeDocumentCount}{" "}
          {project.activeDocumentCount === 1
            ? "active document"
            : "active documents"}
          {project.draftFileCount > 0 && (
            <span>· {project.draftFileCount} draft</span>
          )}
        </p>
        <p className="flex items-center gap-2">
          <Clock3 aria-hidden className="h-4 w-4" /> Updated{" "}
          {formatUpdatedAt(project.updatedAt)}
        </p>
      </div>
      <div className="mt-auto pt-5">
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
      </div>
    </li>
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
      <div
        aria-hidden
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {[0, 1, 2, 3, 4, 5].map((item) => (
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

function ProjectWorkspaceFallback() {
  return (
    <ApplicationShell>
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <div className="mb-6 h-16 w-72 animate-pulse rounded-lg bg-border/60" />
        <ProjectSkeleton />
      </main>
    </ApplicationShell>
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
