"use client";

import { Copy, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getPlsqlDependencies, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlDependencySummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import {
  DependencyDetailTable,
  type DetailTableColumn,
} from "./dependency-detail-table";
import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
} from "./dependency-graph";
import { dependencyToPath, DependencyPathTrail } from "./dependency-path-trail";
import {
  evidenceLineLabel,
  evidenceLocation,
  RelationshipChip,
  ResolutionBadge,
} from "./plsql-atoms";
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

/** One compact result row: the edge plus whichever endpoint isn't the analyzed object. */
type DependencyListRow = {
  id: string;
  other: PlsqlObjectReference;
  edge: PlsqlDependency;
};

export function DependenciesPanel({
  object,
  initialCategory,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onAnalyzeObject,
  onInspectPath,
}: {
  object: PlsqlObject;
  /** Category selected on first render, e.g. arriving from Overview's "View all in Dependencies". */
  initialCategory?: PlsqlDependencyCategory;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  /** Graph node taps navigate: drilling into a node's own neighborhood is the point of the graph. */
  onOpenObject: (reference: PlsqlObjectReference) => void;
  /** Source/target chips in the selected-dependency trail inspect in place instead,
   * matching the Paths view: navigating away would reset this panel back to
   * its default category (see the objectId-keyed reset effect above). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  /** "Analyze impact" contextual action for the selected dependency's other object. */
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
  /** "View full path" contextual action: shows the one-hop edge as a path in the Inspector. */
  onInspectPath?: (path: PlsqlPath) => void;
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

  const counts = (() => {
    for (const entry of CATEGORIES) {
      const page = pages[entry.value];
      if (page) return page.counts;
    }
    return undefined;
  })();

  function buildGraph() {
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
  }

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

  function selectEdge(edge: PlsqlDependency) {
    onInspectEdge?.(edge);
    setSelectedEdge((current) => (current?.id === edge.id ? undefined : edge));
  }

  const activePage = pages[category];
  const activeSummary =
    viewMode === "list" && status === "ready" ? activePage : undefined;
  const graph = viewMode === "graph" ? buildGraph() : undefined;
  const activeCategoryLabel = CATEGORIES.find(
    (entry) => entry.value === category,
  )?.label;

  const rows: DependencyListRow[] = (activeSummary?.items ?? []).map(
    (edge) => ({
      id: edge.id,
      other: edge.source.id === objectId ? edge.target : edge.source,
      edge,
    }),
  );

  const columns: DetailTableColumn<DependencyListRow>[] = [
    {
      header: "Related object",
      cell: (row) => (
        <span
          title={row.other.qualifiedName}
          className="break-words font-medium"
        >
          {row.other.name}
        </span>
      ),
    },
    {
      header: "Relationship",
      cell: (row) => <RelationshipChip relationship={row.edge.relationship} />,
    },
    {
      header: "Resolution",
      cell: (row) => <ResolutionBadge resolution={row.edge.resolution} />,
    },
    {
      header: "Evidence",
      cell: (row) => {
        const label = evidenceLineLabel(row.edge.evidence);
        const fullLocation = evidenceLocation(row.edge.evidence);
        if (label === undefined) {
          return <span className="text-text-muted">—</span>;
        }
        if (!row.edge.evidence?.sourceFileId) {
          return (
            <span
              title={fullLocation}
              className="break-words text-xs text-text-secondary"
            >
              {label}
            </span>
          );
        }
        return (
          <button
            type="button"
            title={fullLocation}
            onClick={(event) => {
              event.stopPropagation();
              selectEdge(row.edge);
            }}
            className="break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {label}
          </button>
        );
      },
    },
  ];

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

      {viewMode === "graph" && status === "ready" && graph && (
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
              if (edge) selectEdge(edge);
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
        <section
          aria-label="Dependency results"
          className="mt-3 rounded-lg border bg-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              Dependency results
            </h3>
            {activeSummary.truncated && (
              <span className="text-xs text-warning">Results truncated</span>
            )}
          </div>
          <DependencyDetailTable
            ariaLabel={`${activeCategoryLabel ?? "Dependency"} results`}
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            selectedId={selectedEdge?.id}
            onSelectRow={(row) => selectEdge(row.edge)}
            emptyMessage="No matching dependencies"
            bordered={false}
          />
        </section>
      )}

      {status === "ready" && selectedEdge && (
        <SelectedDependency
          edge={selectedEdge}
          objectId={objectId}
          onClose={() => setSelectedEdge(undefined)}
          onOpenObject={onOpenObject}
          onInspectObject={onInspectObject}
          onInspectEdge={onInspectEdge}
          onAnalyzeObject={onAnalyzeObject}
          onInspectPath={onInspectPath}
          onOpenEvidence={onOpenEvidence}
        />
      )}
    </section>
  );
}

function SelectedDependency({
  edge,
  objectId,
  onClose,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onAnalyzeObject,
  onInspectPath,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  objectId: string;
  onClose: () => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
  onInspectPath?: (path: PlsqlPath) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const other = edge.source.id === objectId ? edge.target : edge.source;
  const evidence = edge.evidence;
  const lineLabel = evidenceLineLabel(evidence);
  // A single edge is a one-hop path, so it reuses the same trail the
  // Impact and Paths views use to explain a chain of relationships.
  const path = dependencyToPath(edge);
  const [copied, setCopied] = useState(false);

  async function copyQualifiedName() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(other.qualifiedName);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-label="Selected dependency"
      className="mt-6 rounded-lg border bg-background"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          Selected dependency
        </h3>
        <button
          type="button"
          aria-label="Close selected dependency"
          onClick={onClose}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-text-secondary hover:bg-selected hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="grid items-start divide-y lg:grid-cols-[35%_1fr] lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <DependencyPathTrail
            path={path}
            onOpenObject={onInspectObject}
            onInspectEdge={onInspectEdge}
            showKind
          />
          {/* The full path/line already appears once, in the source evidence
           * header on the right; here we only need the line number next to
           * the confidence badge (see item 4's "Resolved · line 58"). */}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <ResolutionBadge resolution={edge.resolution} />
            {lineLabel !== undefined && (
              <>
                <span aria-hidden>·</span>
                <span>{lineLabel}</span>
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenObject(other)}
            >
              Open object
            </Button>
            {onAnalyzeObject && (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Analyze impact for ${other.name}`}
                onClick={() => onAnalyzeObject(other)}
              >
                Analyze impact
              </Button>
            )}
            {onInspectPath && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onInspectPath({ id: edge.id, ...path, hopCount: 1 })
                }
              >
                View full path
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyQualifiedName()}
            >
              <Copy aria-hidden /> {copied ? "Copied" : "Copy qualified name"}
            </Button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? "Qualified name copied to clipboard." : ""}
          </p>
        </div>
        <section aria-label="Source evidence" className="min-w-0 p-4">
          {evidence?.sourceFileId ? (
            <SourceBody
              heading="Source evidence"
              onOpenFullSource={() => onOpenEvidence(evidence)}
              request={{
                kind: "file",
                fileId: evidence.sourceFileId,
                startLine: evidence.startLine ?? undefined,
                endLine: evidence.startLine ?? undefined,
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              No source evidence available for this dependency.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
