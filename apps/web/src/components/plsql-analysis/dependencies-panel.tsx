"use client";

import { LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getPlsqlDependencies, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlDependencySummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
} from "./dependency-graph";
import { dependencyToPath, DependencyPathTrail } from "./dependency-path-trail";
import { evidenceLocation, ResolutionBadge } from "./plsql-atoms";
import { SourceBody } from "./source-viewer";
import { ViewModeToggle, type ViewMode } from "./view-mode-toggle";

type SectionStatus = "loading" | "ready" | "error";

const CATEGORIES: { value: PlsqlDependencyCategory; label: string }[] = [
  { value: "callers", label: "Callers" },
  { value: "callees", label: "Callees" },
  { value: "reads", label: "Reads" },
  { value: "writes", label: "Writes" },
  { value: "other", label: "Other" },
];

export function DependenciesPanel({
  object,
  initialCategory,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
}: {
  object: PlsqlObject;
  /** Category selected on first render, e.g. arriving from Overview's "View all in Dependencies". */
  initialCategory?: PlsqlDependencyCategory;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  /** Graph node taps navigate: drilling into a node's own neighborhood is the point of the graph. */
  onOpenObject: (reference: PlsqlObjectReference) => void;
  /** Source/target chips in the list-mode detail card inspect in place instead,
   * matching the Paths view: navigating away would reset this panel back to
   * its default category (see the objectId-keyed reset effect above). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const objectId = object.id;
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [category, setCategory] = useState<PlsqlDependencyCategory>(
    initialCategory ?? "callers",
  );
  const [pages, setPages] = useState<
    Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>
  >({});
  const [expanded, setExpanded] = useState<
    ReadonlySet<PlsqlDependencyCategory>
  >(() => new Set());
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [attempt, setAttempt] = useState(0);
  const [selectedEdge, setSelectedEdge] = useState<PlsqlDependency>();

  // Reset per-object state so graphs and lists never mix two objects.
  useEffect(() => {
    setPages({});
    setExpanded(new Set());
    setCategory(initialCategory ?? "callers");
    setSelectedEdge(undefined);
  }, [objectId, initialCategory]);

  // List mode: load the active category.
  useEffect(() => {
    if (viewMode !== "list") return;
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    getPlsqlDependencies(objectId, category)
      .then((value) => {
        if (cancelled) return;
        setPages((prev) => ({ ...prev, [category]: value }));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorCode(problemCodeOf(error));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, category, viewMode, attempt]);

  // Graph mode: load every expanded category not fetched yet.
  useEffect(() => {
    if (viewMode !== "graph") return;
    const missing = CATEGORIES.map((entry) => entry.value).filter(
      (value) => expanded.has(value) && !pages[value],
    );
    if (missing.length === 0) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    Promise.all(missing.map((value) => getPlsqlDependencies(objectId, value)))
      .then((values) => {
        if (cancelled) return;
        setPages((prev) => {
          const next = { ...prev };
          missing.forEach((value, index) => {
            next[value] = values[index];
          });
          return next;
        });
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorCode(problemCodeOf(error));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, viewMode, expanded, pages, attempt]);

  const counts = useMemo(() => {
    for (const entry of CATEGORIES) {
      const page = pages[entry.value];
      if (page) return page.counts;
    }
    return undefined;
  }, [pages]);

  const graph = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const refById = new Map<string, PlsqlObjectReference>();
    const edges: GraphEdge[] = [];
    const ensure = (ref: PlsqlObjectReference, focused = false) => {
      if (!nodeMap.has(ref.id)) {
        nodeMap.set(ref.id, {
          id: ref.id,
          label: ref.qualifiedName,
          kind: ref.kind,
          focused: focused ? true : undefined,
        });
        refById.set(ref.id, ref);
      }
    };
    ensure(
      {
        id: object.id,
        kind: object.kind,
        name: object.name,
        schema: object.schema,
        qualifiedName: object.qualifiedName,
      },
      true,
    );
    for (const entry of CATEGORIES) {
      if (!expanded.has(entry.value)) continue;
      const page = pages[entry.value];
      if (!page) continue;
      for (const edge of page.items) {
        ensure(edge.source);
        ensure(edge.target);
        edges.push({
          id: edge.id,
          source: edge.source.id,
          target: edge.target.id,
          label: edge.relationship,
        });
      }
    }
    const edgeById = new Map<string, PlsqlDependency>();
    for (const entry of CATEGORIES) {
      const page = pages[entry.value];
      if (!page) continue;
      for (const edge of page.items) edgeById.set(edge.id, edge);
    }
    return { nodes: [...nodeMap.values()], edges, refById, edgeById };
  }, [object, pages, expanded]);

  function toggleExpand(value: PlsqlDependencyCategory) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function expandOneLevel() {
    setExpanded(new Set(CATEGORIES.map((entry) => entry.value)));
  }

  const activePage = pages[category];
  const activeSummary =
    viewMode === "list" && status === "ready" ? activePage : undefined;

  return (
    <section aria-label="Dependencies">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {viewMode === "list" ? (
          <div
            role="group"
            aria-label="Dependency category"
            className="flex flex-wrap gap-2"
          >
            {CATEGORIES.map((entry) => {
              const active = entry.value === category;
              const count = counts?.[entry.value];
              return (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(entry.value)}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
                    active
                      ? "border-transparent bg-selected text-primary"
                      : "bg-surface text-text-secondary hover:bg-background"
                  }`}
                >
                  {entry.label}
                  {count !== undefined && (
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div
            role="group"
            aria-label="Graph expansion"
            className="flex flex-wrap gap-2"
          >
            {CATEGORIES.map((entry) => {
              const isExpanded = expanded.has(entry.value);
              const count = counts?.[entry.value];
              return (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={isExpanded}
                  onClick={() => toggleExpand(entry.value)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${
                    isExpanded
                      ? "border-transparent bg-selected text-primary"
                      : "bg-surface text-text-secondary hover:bg-background"
                  }`}
                >
                  {isExpanded ? (
                    <Minus aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <Plus aria-hidden className="h-3.5 w-3.5" />
                  )}
                  {entry.label}
                  {count !== undefined && (
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={expandOneLevel}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-sm font-medium text-text-secondary hover:bg-background"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" /> One level
            </button>
          </div>
        )}
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {status === "loading" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading dependencies…
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError
            code={errorCode}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        </div>
      )}
      {status === "ready" && selectedEdge && (
        <DependencySourceSplit
          edge={selectedEdge}
          onClose={() => setSelectedEdge(undefined)}
          onInspectObject={onInspectObject}
          onInspectEdge={onInspectEdge}
        />
      )}
      {viewMode === "graph" && status === "ready" && (
        <>
          <DependencyGraph
            nodes={graph.nodes}
            edges={graph.edges}
            onSelectNode={(nodeId) => {
              const ref = graph.refById.get(nodeId);
              if (ref) onOpenObject(ref);
            }}
            onSelectEdge={(edgeId) => {
              const edge = graph.edgeById.get(edgeId);
              if (edge) {
                setSelectedEdge(edge);
                onInspectEdge?.(edge);
              }
            }}
            ariaLabel={`Dependency graph for ${object.qualifiedName}`}
          />
          {expanded.size === 0 && (
            <p className="mt-2 text-sm text-text-secondary">
              Expand a category to explore the neighborhood of {object.name}.
            </p>
          )}
        </>
      )}
      {viewMode === "list" && activeSummary && (
        <>
          {activeSummary.truncated && (
            <p className="mt-2 text-sm text-warning">Results truncated</p>
          )}
          {activeSummary.items.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              No matching dependencies
            </p>
          ) : (
            <ul className="mt-3 divide-y rounded-lg border bg-surface">
              {activeSummary.items.map((edge) => (
                <DependencyRow
                  key={edge.id}
                  edge={edge}
                  onSelect={() => {
                    onInspectEdge?.(edge);
                    setSelectedEdge((current) =>
                      current?.id === edge.id ? undefined : edge,
                    );
                  }}
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

function DependencyRow({
  edge,
  onSelect,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onSelect: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const location = evidenceLocation(edge.evidence);
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Show dependency details for ${edge.source.qualifiedName} ${edge.relationship} ${edge.target.qualifiedName}`}
        className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="min-w-0 flex-1 break-words text-sm">
          {edge.source.qualifiedName}
          <span aria-hidden> → </span>
          <span className="font-medium">{edge.relationship}</span>
          <span aria-hidden> → </span>
          {edge.target.qualifiedName}
        </span>
        <ResolutionBadge resolution={edge.resolution} />
      </button>
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

function DependencySourceSplit({
  edge,
  onClose,
  onInspectObject,
  onInspectEdge,
}: {
  edge: PlsqlDependency;
  onClose: () => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const evidence = edge.evidence;
  const location = evidenceLocation(evidence);
  // A single edge is a one-hop path, so it reuses the same trail the
  // Impact and Paths views use to explain a chain of relationships.
  const path = dependencyToPath(edge);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section
        aria-label="Dependency details"
        className="rounded-lg border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-secondary">
            Dependency
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded px-2 text-sm underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Close
          </button>
        </div>
        <div className="mt-3">
          <DependencyPathTrail
            path={path}
            onOpenObject={onInspectObject}
            onInspectEdge={onInspectEdge}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ResolutionBadge resolution={edge.resolution} />
          {location !== undefined && (
            <span className="text-xs text-text-secondary">{location}</span>
          )}
        </div>
      </section>
      <section aria-label="Source evidence" className="min-w-0">
        {evidence?.sourceFileId ? (
          <SourceBody
            request={{
              kind: "file",
              fileId: evidence.sourceFileId,
              startLine: evidence.startLine ?? undefined,
              endLine: evidence.startLine ?? undefined,
            }}
          />
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
            No source evidence for this dependency
          </p>
        )}
      </section>
    </div>
  );
}
