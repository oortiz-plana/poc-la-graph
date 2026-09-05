"use client";

import {
  ArrowLeft,
  LoaderCircle,
  Network,
  Search,
  TriangleAlert,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { ApplicationShell } from "@/components/application-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  findPlsqlPaths,
  getPlsqlObject,
  getPlsqlTableAccess,
  listPlsqlCallers,
  listPlsqlCallees,
  listPlsqlUnresolved,
  searchPlsqlObjects,
} from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyResult,
  PlsqlObject,
  PlsqlObjectKind,
  PlsqlObjectSearchResult,
  PlsqlPath,
  PlsqlPathResult,
  PlsqlRelationship,
  PlsqlResolution,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { SourceViewer, type SourceRequest } from "./source-viewer";
import { ImpactReport } from "./impact-report";

type SearchStatus = "idle" | "searching" | "ready" | "error";
type DetailStatus = "idle" | "loading" | "ready" | "error";

export function PlsqlAnalysisWorkspace() {
  const auth = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<PlsqlObjectSearchResult>();
  const [detailStatus, setDetailStatus] = useState<DetailStatus>("idle");
  const [detailId, setDetailId] = useState<string>();
  const [detail, setDetail] = useState<PlsqlObject>();
  const [sourceRequest, setSourceRequest] = useState<SourceRequest>();
  // Persistent polite live region: announces search completion so screen
  // readers hear summaries even when the transient loading text unmounts.
  const [announcement, setAnnouncement] = useState("");
  const detailOpenerRef = useRef<HTMLButtonElement | null>(null);
  const sourceOpenerRef = useRef<HTMLElement | null>(null);

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setAnnouncement("");
    setStatus("searching");
    setDetailId(undefined);
    setDetailStatus("idle");
    setDetail(undefined);
    try {
      const found = await searchPlsqlObjects(query);
      setResult(found);
      setStatus("ready");
      setAnnouncement(
        found.items.length === 0
          ? "Search complete: no matching objects."
          : `Search complete: ${found.items.length} matching object${
              found.items.length === 1 ? "" : "s"
            }.`,
      );
    } catch {
      setStatus("error");
    }
  }

  async function openDetail(
    objectId: string,
    opener?: HTMLButtonElement | null,
  ) {
    // Keep the existing opener when retrying so Back restores the same row.
    detailOpenerRef.current = opener ?? detailOpenerRef.current;
    setDetailId(objectId);
    setDetailStatus("loading");
    try {
      const loaded = await getPlsqlObject(objectId);
      if (!loaded) throw new Error("Object not found");
      setDetail(loaded);
      setDetailStatus("ready");
    } catch {
      setDetailStatus("error");
    }
  }

  function backToResults() {
    setDetailId(undefined);
    setDetailStatus("idle");
    setDetail(undefined);
    // Restore focus to the control that opened the detail, falling back to
    // the search field when it is gone (e.g. results were refreshed).
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    window.setTimeout(() => {
      if (opener?.isConnected) {
        opener.focus();
      } else {
        document.getElementById("plsql-search-input")?.focus();
      }
    }, 0);
  }

  function rememberSourceOpener() {
    const active = document.activeElement;
    sourceOpenerRef.current = active instanceof HTMLElement ? active : null;
  }

  function openObjectSource(objectId: string) {
    rememberSourceOpener();
    setSourceRequest({ kind: "object", objectId });
  }

  function openEvidenceSource(evidence: PlsqlSourceCoordinate | null) {
    if (!evidence?.sourceFileId) return;
    rememberSourceOpener();
    setSourceRequest({
      kind: "file",
      fileId: evidence.sourceFileId,
      startLine: evidence.startLine ?? undefined,
    });
  }

  function closeSource() {
    setSourceRequest(undefined);
    const opener = sourceOpenerRef.current;
    sourceOpenerRef.current = null;
    window.setTimeout(() => {
      if (opener?.isConnected) opener.focus();
    }, 0);
  }

  return (
    <ApplicationShell>
      <main className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <header>
          <div className="flex items-center gap-3">
            <Network aria-hidden className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-semibold">PL/SQL analysis</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary">
            Search analyzed database objects and inspect their definitions
            without editing source.
          </p>
        </header>
        {auth.config.plsqlEnabled ? (
          <>
            <form onSubmit={(event) => void runSearch(event)} className="mt-6">
              <label className="block max-w-2xl text-sm font-medium">
                Search PL/SQL objects
                <input
                  id="plsql-search-input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name or qualified name"
                  className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
                />
              </label>
              <Button type="submit" className="mt-3">
                <Search aria-hidden /> Search objects
              </Button>
            </form>

            <section aria-label="Search results" className="mt-6">
              {status === "searching" && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-text-secondary"
                >
                  <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                  Searching…
                </p>
              )}
              {status === "error" && (
                <AnalysisError onRetry={() => void runSearch()} />
              )}
              {status === "ready" && result && (
                <>
                  {result.truncated && (
                    <p className="text-sm text-warning">Results truncated</p>
                  )}
                  {result.items.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-sm text-text-secondary">
                      No objects match
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y rounded-lg border bg-surface">
                      {result.items.map((object) => (
                        <li key={object.id}>
                          <button
                            type="button"
                            onClick={(event) =>
                              void openDetail(object.id, event.currentTarget)
                            }
                            className="flex min-h-11 w-full flex-wrap items-center gap-3 px-3 py-2 text-left hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            <ObjectKindBadge kind={object.kind} />
                            <span className="min-w-0 flex-1 break-words text-sm font-medium">
                              {object.name} · {object.qualifiedName}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            {detailStatus === "loading" && (
              <p
                role="status"
                className="mt-6 flex items-center gap-2 text-sm text-text-secondary"
              >
                <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                Loading object details…
              </p>
            )}
            {detailStatus === "error" && detailId && (
              <div className="mt-6">
                <AnalysisError onRetry={() => void openDetail(detailId)} />
              </div>
            )}

            {detailStatus === "ready" && detail && (
              <ObjectDetail
                key={detail.id}
                object={detail}
                onBack={backToResults}
                onViewSource={openObjectSource}
                onOpenEvidence={openEvidenceSource}
              />
            )}

            <DependencyPathsSection
              candidates={result?.items ?? []}
              onOpenObject={(objectId, opener) =>
                void openDetail(objectId, opener)
              }
            />
            <UnresolvedReferencesSection onOpenEvidence={openEvidenceSource} />
            {sourceRequest && (
              <SourceViewer request={sourceRequest} onClose={closeSource} />
            )}
          </>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
            Analysis is not configured
          </p>
        )}
      </main>
    </ApplicationShell>
  );
}

function AnalysisError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-error-border bg-error-surface p-4 text-error"
    >
      <p className="text-sm">Analysis is unavailable</p>
      <Button variant="outline" className="mt-3" onClick={onRetry}>
        Retry analysis query
      </Button>
    </div>
  );
}

function ObjectKindBadge({ kind }: { kind: PlsqlObjectKind }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary">
      {kind}
    </span>
  );
}

function ObjectDetail({
  object,
  onBack,
  onViewSource,
  onOpenEvidence,
}: {
  object: PlsqlObject;
  onBack: () => void;
  onViewSource: (objectId: string) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const headingId = "plsql-object-detail-heading";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const declaration = object.declaration;
  const source = declaration?.path
    ? declaration.startLine == null
      ? declaration.path
      : `${declaration.path}:${declaration.startLine}`
    : undefined;
  useEffect(() => {
    // Move focus to the detail heading when it opens below the results so
    // keyboard and screen-reader users follow the newly loaded content.
    headingRef.current?.focus();
  }, []);
  return (
    <section aria-labelledby={headingId} className="mt-8 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="break-words text-xl font-semibold"
          >
            {object.name}
          </h2>
          <Badge variant="outline">{object.kind}</Badge>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back to results
        </Button>
      </div>
      <dl className="mt-4 max-w-3xl divide-y rounded-lg border bg-surface px-4 text-sm">
        <DetailRow label="Schema" value={object.schema} />
        <DetailRow label="Qualified name" value={object.qualifiedName} />
        <DetailRow label="Project ID" value={object.projectId} />
        {object.owner !== null && (
          <DetailRow label="Owner" value={object.owner} />
        )}
        {object.signature !== null && (
          <DetailRow label="Signature" value={object.signature} />
        )}
        {object.returnType !== null && (
          <DetailRow label="Return type" value={object.returnType} />
        )}
        {source !== undefined && (
          <div className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-text-secondary">Source</dt>
            <dd className="min-w-0">
              <button
                type="button"
                onClick={() => onViewSource(object.id)}
                className="min-h-11 break-words text-left underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {source}
              </button>
            </dd>
          </div>
        )}
      </dl>
      <DependencySections
        objectId={object.id}
        onOpenEvidence={onOpenEvidence}
      />
      <div className="mt-10 border-t pt-6">
        <ImpactReport objectId={object.id} onOpenEvidence={onOpenEvidence} />
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

const DEPENDENCY_LOADERS = {
  callers: listPlsqlCallers,
  callees: listPlsqlCallees,
  tableAccess: getPlsqlTableAccess,
} as const;

type DependencyKind = keyof typeof DEPENDENCY_LOADERS;

type SectionStatus = "loading" | "ready" | "error";

const DEPENDENCY_SECTIONS: {
  kind: DependencyKind;
  title: string;
  emptyText: string;
}[] = [
  { kind: "callers", title: "Callers", emptyText: "No callers" },
  { kind: "callees", title: "Callees", emptyText: "No callees" },
  {
    kind: "tableAccess",
    title: "Table access",
    emptyText: "No table access",
  },
];

function DependencySections({
  objectId,
  onOpenEvidence,
}: {
  objectId: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  return (
    <div className="mt-10 space-y-8 border-t pt-6">
      {DEPENDENCY_SECTIONS.map((section) => (
        <DependencySection
          key={section.kind}
          objectId={objectId}
          section={section}
          onOpenEvidence={onOpenEvidence}
        />
      ))}
    </div>
  );
}

function DependencySection({
  objectId,
  section,
  onOpenEvidence,
}: {
  objectId: string;
  section: { kind: DependencyKind; title: string; emptyText: string };
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [result, setResult] = useState<PlsqlDependencyResult>();
  const headingId = `plsql-${section.kind}-heading`;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    DEPENDENCY_LOADERS[section.kind](objectId)
      .then((value) => {
        if (!cancelled) {
          setResult(value);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, section.kind, attempt]);

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-semibold">
        {section.title}
      </h3>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading {section.title.toLowerCase()}…
        </p>
      )}
      {status === "error" && (
        <AnalysisError onRetry={() => setAttempt((current) => current + 1)} />
      )}
      {status === "ready" && result && (
        <>
          {result.truncated && (
            <p className="text-sm text-warning">Results truncated</p>
          )}
          {result.items.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              {section.emptyText}
            </p>
          ) : section.kind === "tableAccess" ? (
            <TableAccessGroups
              items={result.items}
              onOpenEvidence={onOpenEvidence}
            />
          ) : (
            <DependencyList
              items={result.items}
              onOpenEvidence={onOpenEvidence}
            />
          )}
        </>
      )}
    </section>
  );
}

function DependencyList({
  items,
  onOpenEvidence,
}: {
  items: PlsqlDependency[];
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  return (
    <ul className="mt-3 divide-y rounded-lg border bg-surface">
      {items.map((edge) => (
        <DependencyRow
          key={edge.id}
          edge={edge}
          onOpenEvidence={onOpenEvidence}
        />
      ))}
    </ul>
  );
}

function TableAccessGroups({
  items,
  onOpenEvidence,
}: {
  items: PlsqlDependency[];
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const groups: {
    relationship: PlsqlRelationship;
    items: PlsqlDependency[];
  }[] = [];
  for (const edge of items) {
    const group = groups.find(
      (candidate) => candidate.relationship === edge.relationship,
    );
    if (group) group.items.push(edge);
    else groups.push({ relationship: edge.relationship, items: [edge] });
  }
  return (
    <div className="mt-3 space-y-4">
      {groups.map((group) => (
        <div key={group.relationship}>
          <h4 className="text-sm font-semibold text-text-secondary">
            {group.relationship} ({group.items.length})
          </h4>
          <DependencyList items={group.items} onOpenEvidence={onOpenEvidence} />
        </div>
      ))}
    </div>
  );
}

function DependencyRow({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const location = edge.evidence?.path
    ? edge.evidence.startLine == null
      ? edge.evidence.path
      : `${edge.evidence.path}:${edge.evidence.startLine}`
    : undefined;
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1 break-words text-sm">
        {edge.source.qualifiedName}
        <span aria-hidden> → </span>
        <span className="font-medium">{edge.relationship}</span>
        <span aria-hidden> → </span>
        {edge.target.qualifiedName}
      </span>
      <ResolutionBadge resolution={edge.resolution} />
      {location !== undefined && edge.evidence?.sourceFileId ? (
        <button
          type="button"
          onClick={() => onOpenEvidence(edge.evidence)}
          className="min-h-11 min-w-0 max-w-full break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {location}
        </button>
      ) : location !== undefined ? (
        <span className="text-xs text-text-secondary">{location}</span>
      ) : null}
    </li>
  );
}

function ResolutionBadge({ resolution }: { resolution: PlsqlResolution }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary">
      {resolution}
    </span>
  );
}

type PathStatus = "idle" | "loading" | "ready" | "error";

function DependencyPathsSection({
  candidates,
  onOpenObject,
}: {
  candidates: PlsqlObject[];
  onOpenObject: (objectId: string, opener?: HTMLButtonElement | null) => void;
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [status, setStatus] = useState<PathStatus>("idle");
  const [result, setResult] = useState<PlsqlPathResult>();
  const headingId = "plsql-dependency-paths-heading";

  useEffect(() => {
    setFromId(candidates[0]?.id ?? "");
    setToId(candidates[1]?.id ?? candidates[0]?.id ?? "");
    setStatus("idle");
    setResult(undefined);
  }, [candidates]);

  const fromObject = candidates.find((object) => object.id === fromId);
  const toObject = candidates.find((object) => object.id === toId);
  const canTrace = Boolean(fromObject && toObject && fromId !== toId);

  async function tracePaths(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!fromId || !toId || fromId === toId) return;
    setStatus("loading");
    try {
      setResult(await findPlsqlPaths(fromId, toId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t pt-6">
      <h2 id={headingId} className="text-xl font-semibold">
        Dependency paths
      </h2>
      {candidates.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          Search for PL/SQL objects above, then choose From and To objects to
          trace dependency paths.
        </p>
      ) : (
        <>
          <form
            onSubmit={(event) => void tracePaths(event)}
            className="mt-3 max-w-3xl"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                From object
                <select
                  value={fromId}
                  onChange={(event) => setFromId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
                >
                  {candidates.map((object) => (
                    <option key={object.id} value={object.id}>
                      {object.qualifiedName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                To object
                <select
                  value={toId}
                  onChange={(event) => setToId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
                >
                  {candidates.map((object) => (
                    <option key={object.id} value={object.id}>
                      {object.qualifiedName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button type="submit" disabled={!canTrace} className="mt-3">
              Find paths
            </Button>
            {!canTrace && (
              <p className="mt-2 text-xs text-text-secondary">
                Choose two different searched objects to trace paths between
                them.
              </p>
            )}
          </form>

          {status === "loading" && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-text-secondary"
            >
              <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              Loading dependency paths…
            </p>
          )}
          {status === "error" && (
            <div className="mt-3">
              <AnalysisError onRetry={() => void tracePaths()} />
            </div>
          )}
          {status === "ready" && result && (
            <div className="mt-3">
              {result.truncated && (
                <p className="text-sm text-warning">Results truncated</p>
              )}
              {result.items.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                  No dependency paths found
                </p>
              ) : (
                <ol
                  aria-label="Dependency paths between the selected objects"
                  className="mt-2 divide-y rounded-lg border bg-surface"
                >
                  {result.items.map((path) => (
                    <PathRow
                      key={path.id}
                      path={path}
                      onOpenObject={onOpenObject}
                    />
                  ))}
                </ol>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PathRow({
  path,
  onOpenObject,
}: {
  path: PlsqlPath;
  onOpenObject: (objectId: string, opener?: HTMLButtonElement | null) => void;
}) {
  const hopText = path.hopCount === 1 ? "1 hop" : `${path.hopCount} hops`;
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      {path.nodes.map((node, index) => (
        <Fragment key={`${node.id}-${index}`}>
          {index > 0 && (
            <>
              <span aria-hidden>→</span>
              <span className="font-medium">
                {path.relationships[index - 1].relationship}
              </span>
              <span aria-hidden>→</span>
            </>
          )}
          <button
            type="button"
            onClick={(event) => onOpenObject(node.id, event.currentTarget)}
            className="min-h-11 min-w-0 max-w-full break-words rounded underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {node.qualifiedName}
          </button>
        </Fragment>
      ))}
      <span aria-label={`${hopText}, ordered by the analysis result`}>
        <span aria-hidden>·</span> {hopText}
      </span>
    </li>
  );
}

function UnresolvedReferencesSection({
  onOpenEvidence,
}: {
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [result, setResult] = useState<PlsqlDependencyResult>();
  const headingId = "plsql-unresolved-heading";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    listPlsqlUnresolved()
      .then((value) => {
        if (!cancelled) {
          setResult(value);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t pt-6">
      <h2 id={headingId} className="text-xl font-semibold">
        Unresolved references
      </h2>
      <p className="mt-2 flex max-w-3xl items-start gap-2 text-sm text-warning">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        These references could not be resolved with certainty. Their targets may
        not be the objects they appear to name.
      </p>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading unresolved references…
        </p>
      )}
      {status === "error" && (
        <AnalysisError onRetry={() => setAttempt((current) => current + 1)} />
      )}
      {status === "ready" && result && (
        <>
          {result.truncated && (
            <p className="text-sm text-warning">Results truncated</p>
          )}
          {result.items.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              No unresolved references
            </p>
          ) : (
            <ul className="mt-3 divide-y overflow-hidden rounded-lg border border-warning-border bg-warning-surface">
              {result.items.map((edge) => (
                <UnresolvedRow
                  key={edge.id}
                  edge={edge}
                  onOpenEvidence={onOpenEvidence}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function UnresolvedRow({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const location = edge.evidence?.path
    ? edge.evidence.startLine == null
      ? edge.evidence.path
      : `${edge.evidence.path}:${edge.evidence.startLine}`
    : undefined;
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1 break-words text-sm">
        {edge.source.qualifiedName}
        <span aria-hidden> → </span>
        <span className="font-medium">{edge.relationship}</span>
        <span aria-hidden> → </span>
        {edge.target.qualifiedName}
      </span>
      <ResolutionBadge resolution={edge.resolution} />
      {location !== undefined && edge.evidence?.sourceFileId ? (
        <button
          type="button"
          onClick={() => onOpenEvidence(edge.evidence)}
          className="min-h-11 min-w-0 max-w-full break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {location}
        </button>
      ) : location !== undefined ? (
        <span className="text-xs text-text-secondary">{location}</span>
      ) : null}
    </li>
  );
}
