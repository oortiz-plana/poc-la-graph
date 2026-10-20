"use client";

import { Copy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import useSWRInfinite from "swr/infinite";
import { getPlsqlImpact, type PlsqlProblemCode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ImpactDirection,
  ImpactRelationship,
  PlsqlDependency,
  PlsqlImpactItem,
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import {
  DependencyGraph,
  type GraphEdge,
  type GraphNode,
} from "./dependency-graph";
import { DependencyPathTrail } from "./dependency-path-trail";
import {
  displayPackageOf,
  useEvidenceLineLabel,
  evidenceLocation,
  useHopText,
  ObjectKindBadge,
  EVIDENCE_LINK_CLASS,
} from "./plsql-atoms";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";
import { SourceBody } from "./source-viewer";
import { StatCard } from "./stat-card";
import { ViewModeToggle, type ViewMode } from "./view-mode-toggle";
import {
  ANALYSIS_PAGE_SIZE,
  AnalysisPagination,
  AnalysisPaginationScope,
} from "./analysis-pagination";

type SectionStatus = "loading" | "ready" | "error";

type Filters = {
  direction: ImpactDirection;
  depth: number;
  relationship: "All" | ImpactRelationship;
  directOnly: boolean;
  writesOnly: boolean;
};

/** Default hop depth; unbounded walks exceed the backend traversal cap on large tables. */
export const DEFAULT_IMPACT_DEPTH = 5;

const DEFAULT_FILTERS: Filters = {
  direction: "upstream",
  depth: DEFAULT_IMPACT_DEPTH,
  relationship: "All",
  directOnly: false,
  writesOnly: false,
};

/** Used only until the runtime config (the real, deployment-configured
 * ceiling) finishes loading. */
export const FALLBACK_MAX_DEPTH = 5;

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

/** Distance → Package → Object name, the default scan order. */
export function sortImpactItems(items: PlsqlImpactItem[]): PlsqlImpactItem[] {
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

/** Evidence for the shortest path's final hop, shown as the row's evidence. */
function primaryEvidence(item: PlsqlImpactItem): PlsqlSourceCoordinate | null {
  const [shortest] = sortPaths(item.paths);
  return (
    shortest?.relationships[shortest.relationships.length - 1]?.evidence ?? null
  );
}

export function ImpactReport(
  props: ComponentProps<typeof ImpactReportContent>,
) {
  return (
    <AnalysisPaginationScope>
      <ImpactReportContent {...props} />
    </AnalysisPaginationScope>
  );
}

function ImpactReportContent({
  objectId,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  objectId: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  /** Graph node taps navigate: drilling into a node's own neighborhood is the point of the graph. */
  onOpenObject: (reference: PlsqlObjectReference) => void;
  /** The "Why is this affected?" trail inspects in place instead, matching
   * the Paths/Dependencies views: navigating away would discard the
   * analyzed object's blast-radius selection. */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const auth = useAuth();
  const maxDepth = auth.config.plsqlMaxHops ?? FALLBACK_MAX_DEPTH;
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string>();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [groupByPackage, setGroupByPackage] = useState(false);
  const [openPackages, setOpenPackages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const headingId = "plsql-impact-heading";

  const { data, error, size, setSize, isLoading, isValidating, mutate } =
    useSWRInfinite<PlsqlImpactResult>(
      (index, previousPage) => {
        if (index > 0 && !previousPage?.nextCursor) return null;
        return {
          resource: "plsql-impact",
          objectId,
          filters,
          cursor:
            index === 0 ? undefined : (previousPage?.nextCursor ?? undefined),
        };
      },
      async ({
        objectId: requestedId,
        filters: requestedFilters,
        cursor,
      }: {
        objectId: string;
        filters: Filters;
        cursor?: string;
      }) => {
        const value = await getPlsqlImpact(requestedId, {
          limit: ANALYSIS_PAGE_SIZE,
          direction: requestedFilters.direction,
          depth: requestedFilters.directOnly
            ? undefined
            : requestedFilters.depth,
          relationship:
            requestedFilters.relationship === "All"
              ? undefined
              : requestedFilters.relationship,
          directOnly: requestedFilters.directOnly,
          writesOnly: requestedFilters.writesOnly,
          cursor,
        });
        if (!value) throw new Error("The impact report was not found.");
        return value;
      },
      {
        persistSize: false,
        revalidateFirstPage: false,
      },
    );

  const result = useMemo(() => {
    const first = data?.[0];
    if (!first) return undefined;
    const byId = new Map<string, PlsqlImpactItem>();
    for (const page of data) {
      for (const item of page.items) byId.set(item.id, item);
    }
    const last = data[data.length - 1];
    return {
      ...first,
      items: [...byId.values()],
      truncated: Boolean(last?.nextCursor),
      nextCursor: last?.nextCursor ?? null,
    };
  }, [data]);
  const status: SectionStatus = isLoading
    ? "loading"
    : error && !result
      ? "error"
      : result
        ? "ready"
        : "loading";
  const errorCode: PlsqlProblemCode | undefined = error
    ? problemCodeOf(error)
    : undefined;
  const isLoadingMore =
    isValidating && Boolean(data) && size > (data?.length ?? 0);

  useEffect(() => {
    setSelectedId(undefined);
    setSelectedPathIndex(0);
    setFocusNodeId(undefined);
  }, [objectId, filters]);

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
        {t("heading")}
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ImpactControls
          filters={filters}
          maxDepth={maxDepth}
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
            {t("groupByPackage")}
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
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError code={errorCode} onRetry={() => void mutate()} />
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
              onOpenObject={onOpenObject}
              onInspectObject={onInspectObject}
              onInspectEdge={onInspectEdge}
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
          <AnalysisPagination
            loaded={result.items.length}
            total={result.count}
            nextCursor={result.nextCursor}
            loading={isLoadingMore}
            error={Boolean(error)}
            onLoadMore={() => void setSize((current) => current + 1)}
            onRetry={() => void mutate()}
          />
        </>
      )}
    </section>
  );
}

function ImpactControls({
  filters,
  maxDepth,
  onChange,
}: {
  filters: Filters;
  maxDepth: number;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const fieldClass = "flex min-w-32 flex-col text-sm font-medium leading-5";
  const selectClass =
    "mt-1 block min-h-10 w-full rounded-md border bg-surface px-2 text-sm";
  return (
    <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
      <label className={fieldClass}>
        {t("direction")}
        <select
          aria-label={t("direction")}
          value={filters.direction}
          onChange={(event) =>
            onChange({ direction: event.target.value as ImpactDirection })
          }
          className={selectClass}
        >
          <option value="upstream">{t("upstream")}</option>
          <option value="downstream">{t("downstream")}</option>
        </select>
      </label>
      <DepthField
        depth={filters.depth}
        maxDepth={maxDepth}
        disabled={filters.directOnly}
        onChange={(depth) => onChange({ depth })}
      />
      <label className={`${fieldClass} min-w-44`}>
        {t("relationship")}
        <select
          aria-label={t("relationship")}
          value={filters.relationship}
          disabled={filters.writesOnly}
          onChange={(event) =>
            onChange({
              relationship: event.target.value as Filters["relationship"],
            })
          }
          className={selectClass}
        >
          {(
            [
              "All",
              "CALLS",
              "READS",
              "WRITES",
              "VIEW_DEPENDS_ON",
              "FOREIGN_KEY",
              "TRIGGERS",
            ] as const
          ).map((relationship) => (
            <option key={relationship} value={relationship}>
              {relationship === "All" ? t("relationshipAll") : relationship}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-6 flex h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.directOnly}
          onChange={(event) => onChange({ directOnly: event.target.checked })}
        />
        {t("directOnly")}
      </label>
      <label className="mt-6 flex h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.writesOnly}
          onChange={(event) => onChange({ writesOnly: event.target.checked })}
        />
        {t("writesOnly")}
      </label>
    </div>
  );
}

/**
 * Free-form depth: the deployment configures how many hops are actually
 * allowed (`PLSQL_MAX_HOPS`, up to 50), so this can't be a fixed dropdown.
 * Keeps its own draft text while typing and only commits (clamped to
 * `[1, maxDepth]`) on blur or Enter, so a partial number like "1" while
 * aiming for "12" doesn't fire a query or get force-corrected mid-keystroke.
 */
export function DepthField({
  depth,
  maxDepth,
  disabled,
  onChange,
}: {
  depth: number;
  maxDepth: number;
  disabled?: boolean;
  onChange: (depth: number) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const [draft, setDraft] = useState(String(depth));

  useEffect(() => {
    setDraft(String(depth));
  }, [depth]);

  function commit() {
    const parsed = Number(draft);
    const clamped = Number.isFinite(parsed)
      ? Math.min(maxDepth, Math.max(1, Math.round(parsed)))
      : depth;
    setDraft(String(clamped));
    if (clamped !== depth) onChange(clamped);
  }

  return (
    <label className="flex min-w-20 flex-col text-sm font-medium leading-5">
      {t("depth")}
      <input
        type="number"
        inputMode="numeric"
        aria-label={t("depth")}
        min={1}
        max={maxDepth}
        step={1}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        className="mt-1 block min-h-10 w-full rounded-md border bg-surface px-2 text-sm"
      />
      <span className="mt-1 block text-xs font-normal text-text-secondary">
        {t("maxHops", { max: maxDepth })}
      </span>
    </label>
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
  const t = useTranslations("plsqlImpact.impact");
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
        ariaLabel={t("graphLabel", { name: result.object.qualifiedName })}
      />
      {groupByPackage && refsForPackage.size > 0 && (
        <p className="mt-2 text-sm text-text-secondary">
          {t("drillIntoPackage")}
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
  onOpenObject,
  onInspectObject,
  onInspectEdge,
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
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onFocusInGraph: (nodeId: string) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const { summary } = result;
  const items = useMemo(() => sortImpactItems(result.items), [result.items]);
  const selectedItem = items.find((item) => item.id === selectedId);
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-text-secondary">
        {t("blastRadius")}
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={summary.direct} label={t("direct")} />
        <StatCard value={summary.indirect} label={t("indirect")} />
        <StatCard value={summary.packages} label={t("packages")} />
        <StatCard value={summary.tablesModified} label={t("tablesModified")} />
      </dl>
      <h3
        id="plsql-impact-list-heading"
        className="mt-6 text-sm font-semibold text-text-secondary"
      >
        {t("affectedObjects")}
      </h3>
      <div className="mt-2">
        <ListDetailSplit
          list={
            <>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                  {t("noImpacted")}
                </p>
              ) : (
                <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-surface">
                  <table
                    aria-labelledby="plsql-impact-list-heading"
                    className="w-full text-sm"
                  >
                    <thead>
                      <tr className="text-left text-xs text-text-secondary">
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t("columnObject")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t("columnPackage")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t("columnType")}
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-medium"
                        >
                          {t("columnDistance")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t("columnEvidence")}
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
            </>
          }
          detail={
            selectedItem && (
              <ImpactDetail
                item={selectedItem}
                analyzedId={result.object.id}
                pathIndex={selectedPathIndex}
                onPathIndexChange={onPathIndexChange}
                onClose={() => onToggle(selectedItem.id)}
                onOpenEvidence={onOpenEvidence}
                onOpenObject={onOpenObject}
                onInspectObject={onInspectObject}
                onInspectEdge={onInspectEdge}
                onInspectPath={onInspectPath}
                onFocusInGraph={onFocusInGraph}
              />
            )
          }
        />
      </div>
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
  const evidenceLineLabel = useEvidenceLineLabel();
  const hopText = useHopText();
  const pkg = displayPackageOf(item.dependent);
  const evidence = primaryEvidence(item);
  const evidenceLabel = evidenceLineLabel(evidence);
  const evidenceTitle = evidenceLocation(evidence);

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
      <td className="px-3 py-1.5 align-middle">
        {evidenceLabel === undefined ? (
          <span className="text-text-muted">—</span>
        ) : evidence?.sourceFileId ? (
          <button
            type="button"
            title={evidenceTitle}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(item.id);
            }}
            className={EVIDENCE_LINK_CLASS}
          >
            {evidenceLabel}
          </button>
        ) : (
          <span
            title={evidenceTitle}
            className="break-words text-xs text-text-secondary"
          >
            {evidenceLabel}
          </span>
        )}
      </td>
    </tr>
  );
}

function ImpactDetail({
  item,
  analyzedId,
  pathIndex,
  onPathIndexChange,
  onClose,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onFocusInGraph,
}: {
  item: PlsqlImpactItem;
  analyzedId: string;
  pathIndex: number;
  onPathIndexChange: (index: number) => void;
  onClose: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onFocusInGraph: (nodeId: string) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const evidenceLineLabel = useEvidenceLineLabel();
  const hopText = useHopText();
  const paths = useMemo(() => sortPaths(item.paths), [item.paths]);
  const activeIndex = Math.min(pathIndex, paths.length - 1);
  const path = paths[activeIndex];
  const finalEdge = path?.relationships[path.relationships.length - 1];
  const lineLabel = evidenceLineLabel(finalEdge?.evidence);
  const [copied, setCopied] = useState(false);

  async function copyQualifiedName() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.dependent.qualifiedName);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <InsightPanel
      ariaLabel={t("whyLabel", { name: item.dependent.name })}
      title={t("whyTitle")}
      subtitle={item.dependent.qualifiedName}
      closeLabel={t("closeWhy", { name: item.dependent.name })}
      onClose={onClose}
      trail={
        <>
          {path ? (
            <DependencyPathTrail
              path={path}
              highlightedId={analyzedId}
              onOpenObject={onInspectObject}
              onInspectEdge={onInspectEdge}
              showKind
            />
          ) : (
            <p className="text-sm text-text-secondary">{t("noPath")}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">
              {path ? hopText(path.hopCount) : null}
            </span>
            {paths.length > 1 && (
              <span aria-live="polite">
                {t("pathsFound", { count: paths.length })}
              </span>
            )}
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </div>
          {paths.length > 1 && (
            <div className="mt-2">
              <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                {t("path")}
                <select
                  value={activeIndex}
                  onChange={(event) =>
                    onPathIndexChange(Number(event.target.value))
                  }
                  className="min-h-9 rounded-md border bg-surface px-2 text-sm"
                >
                  {paths.map((candidate, candidateIndex) => (
                    <option key={candidate.id} value={candidateIndex}>
                      {t(
                        candidateIndex === 0
                          ? "pathOptionShortest"
                          : "pathOption",
                        {
                          number: candidateIndex + 1,
                          hops: hopText(candidate.hopCount),
                        },
                      )}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenObject(item.dependent)}
            >
              {t("openObject")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => path && onInspectPath(path)}
              disabled={!path}
            >
              {t("viewFullPath")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onFocusInGraph(item.dependent.id)}
            >
              {t("focusInGraph")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyQualifiedName()}
            >
              <Copy aria-hidden />{" "}
              {copied ? t("copied") : t("copyQualifiedName")}
            </Button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? t("copiedAnnouncement") : ""}
          </p>
        </>
      }
      evidence={
        <>
          {finalEdge?.evidence?.sourceFileId ? (
            <SourceBody
              heading={t("sourceEvidence")}
              compact
              onOpenFullSource={() => onOpenEvidence(finalEdge.evidence)}
              request={{
                kind: "file",
                fileId: finalEdge.evidence.sourceFileId,
                startLine: finalEdge.evidence.startLine ?? undefined,
                endLine: finalEdge.evidence.startLine ?? undefined,
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              {t("noEvidence")}
            </p>
          )}
        </>
      }
    />
  );
}
