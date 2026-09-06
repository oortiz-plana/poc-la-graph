"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getPlsqlImpact, type PlsqlProblemCode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ImpactDirection,
  ImpactRelationship,
  PlsqlImpactItem,
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
} from "./dependency-graph";
import { evidenceLocation, ObjectKindBadge } from "./plsql-atoms";
import { StatCard } from "./stat-card";
import { ViewModeToggle, type ViewMode } from "./view-mode-toggle";

type SectionStatus = "loading" | "ready" | "error";

type Filters = {
  direction: ImpactDirection;
  depth: number;
  relationship: "All" | ImpactRelationship;
  directOnly: boolean;
  writesOnly: boolean;
};

const DEFAULT_FILTERS: Filters = {
  direction: "upstream",
  depth: 5,
  relationship: "All",
  directOnly: false,
  writesOnly: false,
};

const MAX_DEPTH = 5;

const ROUTINE_KINDS = new Set(["Procedure", "Function"]);

/** Full package path (schema.package) used for graph grouping. */
function packageOf(qualifiedName: string, kind: string): string | undefined {
  if (kind === "Package") return qualifiedName;
  const segments = qualifiedName.split(".");
  if (ROUTINE_KINDS.has(kind) && segments.length >= 3) {
    return segments.slice(0, 2).join(".");
  }
  return undefined;
}

/** Bare package name (without schema) shown in the Object table. */
function displayPackageOf(ref: PlsqlObjectReference): string | undefined {
  if (ref.kind === "Package") return undefined;
  const segments = ref.qualifiedName.split(".");
  if (ROUTINE_KINDS.has(ref.kind) && segments.length >= 3) {
    return segments.slice(1, -1).join(".");
  }
  return undefined;
}

function hopText(distance: number): string {
  return distance === 1 ? "1 hop" : `${distance} hops`;
}

/** Distance → Package → Object name, the default scan order. */
function sortImpactItems(items: PlsqlImpactItem[]): PlsqlImpactItem[] {
  return [...items].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const pkgA = displayPackageOf(a.dependent) ?? "";
    const pkgB = displayPackageOf(b.dependent) ?? "";
    const byPackage = pkgA.localeCompare(pkgB, undefined, {
      sensitivity: "base",
    });
    if (byPackage !== 0) return byPackage;
    return a.dependent.name.localeCompare(b.dependent.name, undefined, {
      sensitivity: "base",
    });
  });
}

/** Shortest path first, then deterministic by id. */
function sortPaths(paths: PlsqlPath[]): PlsqlPath[] {
  return [...paths].sort(
    (a, b) => a.hopCount - b.hopCount || a.id.localeCompare(b.id),
  );
}

export function ImpactReport({
  objectId,
  onOpenEvidence,
  onOpenObject,
  onInspectPath,
}: {
  objectId: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectPath: (path: PlsqlPath) => void;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [result, setResult] = useState<PlsqlImpactResult>();
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string>();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [groupByPackage, setGroupByPackage] = useState(false);
  const [openPackages, setOpenPackages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const headingId = "plsql-impact-heading";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    getPlsqlImpact(objectId, {
      direction: filters.direction,
      depth: filters.directOnly ? undefined : filters.depth,
      relationship:
        filters.relationship === "All" ? undefined : filters.relationship,
      directOnly: filters.directOnly,
      writesOnly: filters.writesOnly,
    })
      .then((value) => {
        if (cancelled) return;
        if (!value) {
          setStatus("error");
          return;
        }
        setResult(value);
        setSelectedId(undefined);
        setSelectedPathIndex(0);
        setFocusNodeId(undefined);
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
  }, [objectId, filters, attempt]);

  function toggleSelection(id: string) {
    setSelectedId((current) => (current === id ? undefined : id));
    setSelectedPathIndex(0);
  }

  function selectId(id: string) {
    setSelectedId(id);
    setSelectedPathIndex(0);
  }

  function focusInGraph(nodeId: string) {
    setFocusNodeId(nodeId);
    setViewMode("graph");
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        Impact analysis
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ImpactControls
          filters={filters}
          onChange={(next) => setFilters({ ...filters, ...next })}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={groupByPackage}
              onChange={(event) => {
                setGroupByPackage(event.target.checked);
                setOpenPackages(new Set());
              }}
            />
            Group by package
          </label>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading impact analysis…
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
      {status === "ready" && result && (
        <>
          {viewMode === "list" ? (
            <ImpactBody
              result={result}
              selectedId={selectedId}
              selectedPathIndex={selectedPathIndex}
              onToggle={toggleSelection}
              onSelect={selectId}
              onPathIndexChange={setSelectedPathIndex}
              onOpenEvidence={onOpenEvidence}
              onInspectPath={onInspectPath}
              onFocusInGraph={focusInGraph}
            />
          ) : (
            <ImpactGraph
              result={result}
              focusNodeId={focusNodeId}
              groupByPackage={groupByPackage}
              openPackages={openPackages}
              onTogglePackage={(packageName) =>
                setOpenPackages((current) => {
                  const next = new Set(current);
                  if (next.has(packageName)) next.delete(packageName);
                  else next.add(packageName);
                  return next;
                })
              }
              onOpenObject={onOpenObject}
            />
          )}
        </>
      )}
    </section>
  );
}

function ImpactControls({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const selectClass = "min-h-10 rounded-md border bg-surface px-2 text-sm";
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="block text-sm font-medium">
        Direction
        <select
          aria-label="Direction"
          value={filters.direction}
          onChange={(event) =>
            onChange({ direction: event.target.value as ImpactDirection })
          }
          className={`mt-1 block ${selectClass}`}
        >
          <option value="upstream">Upstream</option>
          <option value="downstream">Downstream</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Depth
        <select
          aria-label="Depth"
          value={filters.depth}
          disabled={filters.directOnly}
          onChange={(event) => onChange({ depth: Number(event.target.value) })}
          className={`mt-1 block ${selectClass}`}
        >
          {Array.from({ length: MAX_DEPTH }, (_, index) => index + 1).map(
            (depth) => (
              <option key={depth} value={depth}>
                {depth}
              </option>
            ),
          )}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Relationship
        <select
          aria-label="Relationship"
          value={filters.relationship}
          disabled={filters.writesOnly}
          onChange={(event) =>
            onChange({
              relationship: event.target.value as Filters["relationship"],
            })
          }
          className={`mt-1 block ${selectClass}`}
        >
          {(
            ["All", "CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON"] as const
          ).map((relationship) => (
            <option key={relationship} value={relationship}>
              {relationship}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.directOnly}
          onChange={(event) => onChange({ directOnly: event.target.checked })}
        />
        Direct only
      </label>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.writesOnly}
          onChange={(event) => onChange({ writesOnly: event.target.checked })}
        />
        Writes only
      </label>
    </div>
  );
}

type ImpactGraphProps = {
  result: PlsqlImpactResult;
  focusNodeId?: string;
  groupByPackage: boolean;
  openPackages: ReadonlySet<string>;
  onTogglePackage: (packageName: string) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
};

function ImpactGraph({
  result,
  focusNodeId,
  groupByPackage,
  openPackages,
  onTogglePackage,
  onOpenObject,
}: ImpactGraphProps) {
  const nodeMap = new Map<string, GraphNode>();
  const refById = new Map<string, PlsqlObjectReference>();
  const refByPackage = new Map<string, PlsqlObjectReference[]>();
  const edges: GraphEdge[] = [];

  const ensure = (ref: PlsqlObjectReference, focused = false) => {
    const packageName = groupByPackage
      ? packageOf(ref.qualifiedName, ref.kind)
      : undefined;
    if (packageName && !openPackages.has(packageName)) {
      if (!nodeMap.has(`pkg://${packageName}`)) {
        nodeMap.set(`pkg://${packageName}`, {
          id: `pkg://${packageName}`,
          label: packageName,
          kind: "Package",
        });
      }
      refByPackage.set(packageName, [
        ...(refByPackage.get(packageName) ?? []),
        ref,
      ]);
      return `pkg://${packageName}`;
    }
    if (!nodeMap.has(ref.id)) {
      nodeMap.set(ref.id, {
        id: ref.id,
        label: ref.qualifiedName,
        kind: ref.kind,
        focused: focused ? true : undefined,
      });
      refById.set(ref.id, ref);
    }
    return ref.id;
  };

  ensure(result.object, focusNodeId === undefined);
  for (const item of result.items) {
    ensure(item.dependent, item.dependent.id === focusNodeId);
    for (const path of item.paths) {
      for (const relationship of path.relationships) {
        const sourceId = ensure(relationship.source);
        const targetId = ensure(relationship.target);
        if (sourceId === targetId) continue;
        edges.push({
          id: relationship.id,
          source: sourceId,
          target: targetId,
          label: relationship.relationship,
        });
      }
    }
  }

  const nodes = [...nodeMap.values()];
  const refsForPackage = refByPackage;
  return (
    <div className="mt-4">
      <DependencyGraph
        nodes={nodes}
        edges={edges}
        onSelectNode={(nodeId) => {
          if (nodeId.startsWith("pkg://")) {
            onTogglePackage(nodeId.slice("pkg://".length));
            return;
          }
          const ref = refById.get(nodeId);
          if (ref) onOpenObject(ref);
        }}
        ariaLabel={`Impact graph for ${result.object.qualifiedName}`}
      />
      {groupByPackage && refsForPackage.size > 0 && (
        <p className="mt-2 text-sm text-text-secondary">
          Select a package node to drill into its routines.
        </p>
      )}
    </div>
  );
}

function ImpactBody({
  result,
  selectedId,
  selectedPathIndex,
  onToggle,
  onSelect,
  onPathIndexChange,
  onOpenEvidence,
  onInspectPath,
  onFocusInGraph,
}: {
  result: PlsqlImpactResult;
  selectedId?: string;
  selectedPathIndex: number;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onPathIndexChange: (index: number) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onFocusInGraph: (nodeId: string) => void;
}) {
  const { summary } = result;
  const items = useMemo(() => sortImpactItems(result.items), [result.items]);
  const selectedItem = items.find((item) => item.id === selectedId);
  return (
    <div className="mt-4">
      {result.truncated && (
        <p className="text-sm text-warning">Results truncated</p>
      )}
      <h3 className="text-sm font-semibold text-text-secondary">
        Blast radius
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={summary.direct} label="Direct" />
        <StatCard value={summary.indirect} label="Indirect dependents" />
        <StatCard value={summary.packages} label="Packages" />
        <StatCard value={summary.tablesModified} label="Tables modified" />
      </dl>
      <h3
        id="plsql-impact-list-heading"
        className="mt-6 text-sm font-semibold text-text-secondary"
      >
        Affected objects
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          No impacted dependents
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border bg-surface">
          <table
            aria-labelledby="plsql-impact-list-heading"
            className="w-full text-sm"
          >
            <thead>
              <tr className="text-left text-xs text-text-secondary">
                <th scope="col" className="px-3 py-2 font-medium">
                  Object
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Package
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Distance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <AffectedObjectRow
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedItem && (
        <ImpactDetail
          item={selectedItem}
          analyzedId={result.object.id}
          pathIndex={selectedPathIndex}
          onPathIndexChange={onPathIndexChange}
          onOpenEvidence={onOpenEvidence}
          onInspectPath={onInspectPath}
          onFocusInGraph={onFocusInGraph}
        />
      )}
    </div>
  );
}

function AffectedObjectRow({
  item,
  selected,
  onToggle,
  onSelect,
}: {
  item: PlsqlImpactItem;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const pkg = displayPackageOf(item.dependent);

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(item.id);
      return;
    }
    const rows = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLTableRowElement>(
        "tr",
      ) ?? [],
    );
    const current = rows.indexOf(event.currentTarget);
    let next = -1;
    if (event.key === "ArrowDown")
      next = Math.min(current + 1, rows.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else return;
    event.preventDefault();
    const target = rows[next];
    target?.focus();
    const targetId = target?.getAttribute("data-impact-id");
    if (targetId) onSelect(targetId);
  }

  return (
    <tr
      data-impact-id={item.id}
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onToggle(item.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
        selected ? "bg-selected" : "hover:bg-background",
      )}
    >
      <td className="px-3 py-1.5 align-middle">
        <span
          title={item.dependent.qualifiedName}
          className="break-words font-medium"
        >
          {item.dependent.name}
        </span>
      </td>
      <td className="px-3 py-1.5 align-middle text-text-secondary">
        {pkg ?? <span className="text-text-muted">—</span>}
      </td>
      <td className="px-3 py-1.5 align-middle">
        <ObjectKindBadge kind={item.dependent.kind} />
      </td>
      <td className="px-3 py-1.5 text-right align-middle text-xs text-text-secondary">
        {hopText(item.distance)}
      </td>
    </tr>
  );
}

function ImpactDetail({
  item,
  analyzedId,
  pathIndex,
  onPathIndexChange,
  onOpenEvidence,
  onInspectPath,
  onFocusInGraph,
}: {
  item: PlsqlImpactItem;
  analyzedId: string;
  pathIndex: number;
  onPathIndexChange: (index: number) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onFocusInGraph: (nodeId: string) => void;
}) {
  const paths = useMemo(() => sortPaths(item.paths), [item.paths]);
  const activeIndex = Math.min(pathIndex, paths.length - 1);
  const path = paths[activeIndex];
  const finalEdge = path?.relationships[path.relationships.length - 1];
  const location = evidenceLocation(finalEdge?.evidence);
  const hasEvidence = Boolean(finalEdge?.evidence?.sourceFileId);

  return (
    <section
      aria-label={`Why ${item.dependent.name} is affected`}
      className="mt-3 rounded-lg border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h4 className="text-sm font-semibold text-text-secondary">
          Why is this affected?
        </h4>
        <span
          title={item.dependent.qualifiedName}
          className="break-words text-xs text-text-muted"
        >
          {item.dependent.qualifiedName}
        </span>
      </div>
      <div className="px-4 py-3">
        {path ? (
          <MiniDependencyPath path={path} highlightedId={analyzedId} />
        ) : (
          <p className="text-sm text-text-secondary">No path available</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">
            {path ? hopText(path.hopCount) : null}
          </span>
          {paths.length > 1 && (
            <span aria-live="polite">{paths.length} paths found</span>
          )}
          <span className="text-text-muted">
            {location ?? "No source evidence"}
          </span>
        </div>
        {paths.length > 1 && (
          <div className="mt-2">
            <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
              Path
              <select
                value={activeIndex}
                onChange={(event) =>
                  onPathIndexChange(Number(event.target.value))
                }
                className="min-h-9 rounded-md border bg-surface px-2 text-sm"
              >
                {paths.map((candidate, candidateIndex) => (
                  <option key={candidate.id} value={candidateIndex}>
                    Path {candidateIndex + 1}
                    {candidateIndex === 0 ? " · shortest" : ""} ·{" "}
                    {hopText(candidate.hopCount)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenEvidence(finalEdge?.evidence ?? null)}
            disabled={!hasEvidence}
          >
            Open source
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => path && onInspectPath(path)}
            disabled={!path}
          >
            View full path
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFocusInGraph(item.dependent.id)}
          >
            Focus in graph
          </Button>
        </div>
      </div>
    </section>
  );
}

function MiniDependencyPath({
  path,
  highlightedId,
}: {
  path: PlsqlPath;
  highlightedId: string;
}) {
  return (
    <ol className="flex flex-col items-center">
      {path.nodes.map((node, index) => (
        <li key={`${node.id}-${index}`} className="flex flex-col items-center">
          {index > 0 && (
            <div
              aria-hidden
              className="flex flex-col items-center py-1 text-text-muted"
            >
              <span className="h-2.5 w-px bg-border" />
              <span className="py-0.5 text-xs font-medium text-text-secondary">
                {path.relationships[index - 1].relationship}
              </span>
              <span aria-hidden>▼</span>
            </div>
          )}
          <span
            title={node.qualifiedName}
            className={cn(
              "inline-flex max-w-full items-center rounded-md border px-3 py-1 text-sm font-medium",
              node.id === highlightedId
                ? "border-primary bg-selected text-primary"
                : "bg-surface text-text-primary",
            )}
          >
            <span className="break-words">{node.name}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
