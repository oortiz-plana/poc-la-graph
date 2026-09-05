"use client";

import { LoaderCircle } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { getPlsqlImpact, type PlsqlProblemCode } from "@/lib/api";
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

function packageOf(qualifiedName: string, kind: string): string | undefined {
  if (kind === "Package") return qualifiedName;
  const segments = qualifiedName.split(".");
  if (ROUTINE_KINDS.has(kind) && segments.length >= 3) {
    return segments.slice(0, 2).join(".");
  }
  return undefined;
}

export function ImpactReport({
  objectId,
  onOpenEvidence,
  onOpenObject,
}: {
  objectId: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [result, setResult] = useState<PlsqlImpactResult>();
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [expandedId, setExpandedId] = useState<string>();
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
        setExpandedId(undefined);
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
              expandedId={expandedId}
              onToggle={(id) =>
                setExpandedId((current) => (current === id ? undefined : id))
              }
              onOpenEvidence={onOpenEvidence}
            />
          ) : (
            <ImpactGraph
              result={result}
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
  const selectClass =
    "min-h-10 rounded-md border bg-surface px-2 text-sm";
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
          {(["All", "CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON"] as const).map(
            (relationship) => (
              <option key={relationship} value={relationship}>
                {relationship}
              </option>
            ),
          )}
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
  groupByPackage: boolean;
  openPackages: ReadonlySet<string>;
  onTogglePackage: (packageName: string) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
};

function ImpactGraph({
  result,
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
      refByPackage.set(
        packageName,
        [...(refByPackage.get(packageName) ?? []), ref],
      );
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

  ensure(result.object, true);
  for (const item of result.items) {
    ensure(item.dependent);
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
  expandedId,
  onToggle,
  onOpenEvidence,
}: {
  result: PlsqlImpactResult;
  expandedId?: string;
  onToggle: (id: string) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const { summary } = result;
  const listLabel = "Affected objects";
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
        {listLabel}
      </h3>
      {result.items.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          No impacted dependents
        </p>
      ) : (
        <ul
          aria-labelledby="plsql-impact-list-heading"
          className="mt-2 divide-y rounded-lg border bg-surface"
        >
          {result.items.map((item) => (
            <li key={item.id}>
              <AffectedObjectRow
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => onToggle(item.id)}
                onOpenEvidence={onOpenEvidence}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AffectedObjectRow({
  item,
  expanded,
  onToggle,
  onOpenEvidence,
}: {
  item: PlsqlImpactItem;
  expanded: boolean;
  onToggle: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="min-w-0 flex-1 break-words text-sm font-medium">
          {item.dependent.qualifiedName}
        </span>
        <ObjectKindBadge kind={item.dependent.kind} />
        <span className="text-xs text-text-secondary">
          {item.distance === 1 ? "1 hop" : `${item.distance} hops`}
        </span>
      </button>
      {expanded && (
        <div className="border-t px-3 py-3">
          <p className="text-sm font-semibold text-text-secondary">
            Why is this affected?
          </p>
          {item.paths.map((path) => (
            <ImpactPath
              key={path.id}
              path={path}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ImpactPath({
  path,
  onOpenEvidence,
}: {
  path: PlsqlPath;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const finalEvidence =
    path.relationships[path.relationships.length - 1]?.evidence;
  const location = evidenceLocation(finalEvidence);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
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
          <span className="break-words">{node.qualifiedName}</span>
        </Fragment>
      ))}
      {location !== undefined && finalEvidence?.sourceFileId && (
        <button
          type="button"
          onClick={() => onOpenEvidence(finalEvidence)}
          className="min-h-11 min-w-0 break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {location}
        </button>
      )}
    </p>
  );
}
