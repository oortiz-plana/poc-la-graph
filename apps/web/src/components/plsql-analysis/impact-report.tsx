"use client";

import { LoaderCircle, Route } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { getPlsqlImpact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ImpactDirection,
  ImpactRelationship,
  ImpactScope,
  PlsqlDependency,
  PlsqlImpactItem,
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { AnalysisError } from "./analysis-error";
import { DependencyPathTrail } from "./dependency-path-trail";
import {
  ObjectCell,
  PackageCell,
  useEvidenceLineLabel,
  edgeOccurrences,
  OccurrencePicker,
  useHopText,
  ObjectKindBadge,
  EvidenceCell,
} from "./plsql-atoms";
import { CopyValueButton } from "./copy-value-button";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";
import {
  groupByPackage as groupItemsByPackage,
  groupDomKey,
  packageKeyOf,
  PackageGroupHeader,
  useCollapsedGroups,
} from "./package-grouping";
import { SourceBody } from "./source-viewer";
import { ImpactMetricCard, MetricBar } from "./impact-metric-card";
import { useImpactSummary } from "./use-impact-summary";
import { usePagedQuery } from "./use-paged-query";
import {
  ANALYSIS_PAGE_SIZE,
  AnalysisPageNavigator,
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
export const FALLBACK_MAX_DEPTH = 100;

/** Shortest path first, then deterministic by id. */
function sortPaths(paths: PlsqlPath[]): PlsqlPath[] {
  return [...paths].sort(
    (a, b) => a.hopCount - b.hopCount || a.id.localeCompare(b.id),
  );
}

/** Final hop of the shortest path: the edge whose call sites explain the row. */
function primaryEdge(item: PlsqlImpactItem): PlsqlDependency | undefined {
  const [shortest] = sortPaths(item.paths);
  return shortest?.relationships[shortest.relationships.length - 1];
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
  groupByPackage,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  objectId: string;
  /** Files the affected objects under collapsible package headers. */
  groupByPackage: boolean;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
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
  const [scope, setScope] = useState<ImpactScope>("all");
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const headingId = "plsql-impact-heading";
  const summary = useImpactSummary({
    objectId,
    direction: filters.direction,
    depth: filters.directOnly ? undefined : filters.depth,
    relationship:
      filters.relationship === "All" ? undefined : filters.relationship,
    directOnly: filters.directOnly,
    writesOnly: filters.writesOnly,
  });

  const [page, setPage] = useState(0);
  // Grouped by package, the list is read in package order (see Dependencies).
  const order = groupByPackage ? "package" : "name";
  const impactPage = usePagedQuery({
    listKey: JSON.stringify(["impact", objectId, filters, scope, order]),
    page,
    fetchPage: async (requestedPage) => {
      const value = await getPlsqlImpact(objectId, {
        limit: ANALYSIS_PAGE_SIZE,
        offset: requestedPage * ANALYSIS_PAGE_SIZE,
        direction: filters.direction,
        depth: filters.directOnly ? undefined : filters.depth,
        relationship:
          filters.relationship === "All" ? undefined : filters.relationship,
        directOnly: filters.directOnly,
        writesOnly: filters.writesOnly,
        scope,
        order,
      });
      if (!value) throw new Error("The impact report was not found.");
      return value;
    },
  });
  const result = impactPage.data;
  const status: SectionStatus = result
    ? "ready"
    : impactPage.failed
      ? "error"
      : "loading";

  useEffect(() => {
    setSelectedId(undefined);
    setSelectedPathIndex(0);
    setScope("all");
    setPage(0);
  }, [objectId, filters]);

  useEffect(() => {
    setPage(0);
    setSelectedId(undefined);
    setSelectedPathIndex(0);
  }, [groupByPackage]);

  function changePage(next: number) {
    setPage(next);
    setSelectedId(undefined);
    setSelectedPathIndex(0);
  }

  function toggleSelection(id: string) {
    setSelectedId((current) => (current === id ? undefined : id));
    setSelectedPathIndex(0);
  }

  function selectId(id: string) {
    setSelectedId(id);
    setSelectedPathIndex(0);
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        {t("heading")}
      </h2>
      <ImpactControls
        filters={filters}
        maxDepth={maxDepth}
        onChange={(next) => setFilters({ ...filters, ...next })}
      />
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
          <AnalysisError
            code={impactPage.errorCode}
            onRetry={impactPage.retry}
          />
        </div>
      )}
      {status === "ready" && result && (
        <>
          <ImpactBody
            result={result}
            summary={summary}
            selectedId={selectedId}
            selectedPathIndex={selectedPathIndex}
            scope={scope}
            groupByPackage={groupByPackage}
            onScopeChange={(next) => {
              setScope((current) => (current === next ? "all" : next));
              setSelectedId(undefined);
              setPage(0);
            }}
            onToggle={toggleSelection}
            onSelect={selectId}
            onPathIndexChange={setSelectedPathIndex}
            onOpenEvidence={onOpenEvidence}
            onInspectObject={onInspectObject}
            onInspectEdge={onInspectEdge}
            onInspectPath={onInspectPath}
          />
          {result.count > 0 && (
            <AnalysisPageNavigator
              page={page}
              pageSize={ANALYSIS_PAGE_SIZE}
              total={result.count}
              loading={impactPage.refreshing}
              error={impactPage.failed}
              onPageChange={changePage}
              onRetry={impactPage.retry}
            />
          )}
        </>
      )}
    </section>
  );
}

const FIELD_LABEL_CLASS = "text-xs font-medium text-text-secondary";
const FIELD_CONTROL_CLASS =
  "h-9 w-full rounded-md border bg-background px-3 text-sm transition-colors hover:border-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

/** A labelled filter control: small caption above a fixed-height control. */
function FilterField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className={FIELD_LABEL_CLASS}>{label}</span>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** A checkbox filter drawn as a chip that fills in when it is on. */
function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors",
        "focus-within:ring-2 focus-within:ring-primary",
        checked
          ? "border-primary bg-selected text-primary"
          : "bg-background text-text-secondary hover:border-text-muted hover:text-foreground",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      {label}
    </label>
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
  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-3 rounded-lg border bg-surface p-3">
      <FilterField label={t("direction")} className="w-36">
        <select
          aria-label={t("direction")}
          value={filters.direction}
          onChange={(event) =>
            onChange({ direction: event.target.value as ImpactDirection })
          }
          className={FIELD_CONTROL_CLASS}
        >
          <option value="upstream">{t("upstream")}</option>
          <option value="downstream">{t("downstream")}</option>
        </select>
      </FilterField>
      <DepthField
        depth={filters.depth}
        maxDepth={maxDepth}
        disabled={filters.directOnly}
        onChange={(depth) => onChange({ depth })}
      />
      <FilterField label={t("relationship")} className="w-44">
        <select
          aria-label={t("relationship")}
          value={filters.relationship}
          disabled={filters.writesOnly}
          onChange={(event) =>
            onChange({
              relationship: event.target.value as Filters["relationship"],
            })
          }
          className={FIELD_CONTROL_CLASS}
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
      </FilterField>
      <div className="flex flex-wrap items-center gap-2">
        <FilterToggle
          label={t("directOnly")}
          checked={filters.directOnly}
          onChange={(directOnly) => onChange({ directOnly })}
        />
        <FilterToggle
          label={t("writesOnly")}
          checked={filters.writesOnly}
          onChange={(writesOnly) => onChange({ writesOnly })}
        />
      </div>
    </div>
  );
}

/**
 * Free-form depth: the deployment configures how many hops are actually
 * allowed (`PLSQL_MAX_HOPS`, up to 100), so this can't be a fixed dropdown.
 * Keeps its own draft text while typing and only commits (clamped to
 * `[1, maxDepth]`) on blur or Enter, so a partial number like "1" while
 * aiming for "12" doesn't fire a query or get force-corrected mid-keystroke.
 */
export function DepthField({
  depth,
  maxDepth,
  disabled,
  layout = "stacked",
  onChange,
}: {
  depth: number;
  maxDepth: number;
  disabled?: boolean;
  /** `inline` sets the label and hint beside the field, to save a row. */
  layout?: "stacked" | "inline";
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

  const input = (
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
      className={cn(
        FIELD_CONTROL_CLASS,
        layout === "inline" && "h-8 w-20 text-center",
      )}
    />
  );
  if (layout === "inline") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className={FIELD_LABEL_CLASS}>{t("depth")}</span>
        {input}
        <span className="text-xs text-text-muted">
          {t("maxHops", { max: maxDepth })}
        </span>
      </label>
    );
  }
  return (
    <FilterField
      label={t("depth")}
      hint={t("maxHops", { max: maxDepth })}
      className="w-40"
    >
      {input}
    </FilterField>
  );
}

function ImpactBody({
  result,
  summary: blastRadius,
  selectedId,
  selectedPathIndex,
  scope,
  groupByPackage,
  onScopeChange,
  onToggle,
  onSelect,
  onPathIndexChange,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  result: PlsqlImpactResult;
  summary: ReturnType<typeof useImpactSummary>;
  selectedId?: string;
  selectedPathIndex: number;
  scope: ImpactScope;
  groupByPackage: boolean;
  onScopeChange: (scope: ImpactScope) => void;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onPathIndexChange: (index: number) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  // Rows keep the server's order: alphabetical by object name.
  const items = result.items;
  const groups = useMemo(
    () =>
      groupByPackage
        ? groupItemsByPackage(items, (item) => packageKeyOf(item.dependent))
        : [],
    [groupByPackage, items],
  );
  const collapsedGroups = useCollapsedGroups();
  const scopeCards: {
    scope: Exclude<ImpactScope, "all">;
    value: number | undefined;
  }[] = [
    { scope: "direct", value: blastRadius.summary?.direct },
    { scope: "indirect", value: blastRadius.summary?.indirect },
    { scope: "packages", value: blastRadius.summary?.packages },
    { scope: "tablesModified", value: blastRadius.summary?.tablesModified },
  ];
  const selectedItem = items.find((item) => item.id === selectedId);
  // Beside the detail pane the list is narrow: fold package and kind under the name.
  const compact = selectedItem !== undefined;
  return (
    <div className="mt-4">
      <h3
        id="plsql-impact-blast-heading"
        className="text-sm font-semibold text-text-secondary"
      >
        {t("blastRadius")}
      </h3>
      {blastRadius.errorCode && (
        <div className="mt-2">
          <AnalysisError
            code={blastRadius.errorCode}
            onRetry={blastRadius.retry}
          />
        </div>
      )}
      <MetricBar
        labelledBy="plsql-impact-blast-heading"
        columns="grid-cols-2 lg:grid-cols-4"
      >
        {scopeCards.map((card) => (
          <ImpactMetricCard
            key={card.scope}
            value={card.value}
            label={t(card.scope)}
            active={scope === card.scope}
            onSelect={() => onScopeChange(card.scope)}
          />
        ))}
      </MetricBar>
      <h3
        id="plsql-impact-list-heading"
        className="mt-6 text-sm font-semibold text-text-secondary"
      >
        {t("affectedObjects")}
      </h3>
      <div className="mt-2">
        <ListDetailSplit
          stickyTop="top-[4.5rem]"
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
                        {!compact && (
                          <>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t("columnPackage")}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t("columnType")}
                            </th>
                          </>
                        )}
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
                    {groupByPackage ? (
                      groups.map((group) => {
                        const collapsed = collapsedGroups.isCollapsed(
                          group.packageName,
                        );
                        return (
                          <tbody
                            key={groupDomKey(group.packageName)}
                            className="divide-y border-t"
                          >
                            <PackageGroupHeader
                              packageName={group.packageName}
                              count={group.items.length}
                              collapsed={collapsed}
                              colSpan={compact ? 3 : 5}
                              onToggle={() =>
                                collapsedGroups.toggle(group.packageName)
                              }
                            />
                            {!collapsed &&
                              group.items.map((item) => (
                                <AffectedObjectRow
                                  key={item.id}
                                  item={item}
                                  selected={selectedId === item.id}
                                  compact={compact}
                                  onToggle={onToggle}
                                  onSelect={onSelect}
                                />
                              ))}
                          </tbody>
                        );
                      })
                    ) : (
                      <tbody className="divide-y">
                        {items.map((item) => (
                          <AffectedObjectRow
                            key={item.id}
                            item={item}
                            selected={selectedId === item.id}
                            compact={compact}
                            onToggle={onToggle}
                            onSelect={onSelect}
                          />
                        ))}
                      </tbody>
                    )}
                  </table>
                </div>
              )}
            </>
          }
          detail={
            selectedItem && (
              <ImpactDetail
                key={selectedItem.id}
                item={selectedItem}
                analyzedId={result.object.id}
                pathIndex={selectedPathIndex}
                onPathIndexChange={onPathIndexChange}
                onClose={() => onToggle(selectedItem.id)}
                onOpenEvidence={onOpenEvidence}
                onInspectObject={onInspectObject}
                onInspectEdge={onInspectEdge}
                onInspectPath={onInspectPath}
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
  compact,
  onToggle,
  onSelect,
}: {
  item: PlsqlImpactItem;
  selected: boolean;
  compact: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hopText = useHopText();
  const edge = primaryEdge(item);

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(item.id);
      return;
    }
    // Every object row of the table (group headers excluded), so arrow keys
    // also cross package groups.
    const rows = Array.from(
      event.currentTarget
        .closest("table")
        ?.querySelectorAll<HTMLTableRowElement>("tr[data-impact-id]") ?? [],
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
        <ObjectCell reference={item.dependent} compact={compact} />
      </td>
      {!compact && (
        <>
          <td className="px-3 py-1.5 align-middle text-text-secondary">
            <PackageCell reference={item.dependent} />
          </td>
          <td className="px-3 py-1.5 align-middle">
            <ObjectKindBadge kind={item.dependent.kind} />
          </td>
        </>
      )}
      <td className="px-3 py-1.5 text-right align-middle text-xs text-text-secondary">
        {hopText(item.distance)}
      </td>
      <td className="px-3 py-1.5 align-middle">
        <EvidenceCell edge={edge} onSelect={() => onToggle(item.id)} />
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
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  item: PlsqlImpactItem;
  analyzedId: string;
  pathIndex: number;
  onPathIndexChange: (index: number) => void;
  onClose: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
}) {
  const t = useTranslations("plsqlImpact.impact");
  const evidenceLineLabel = useEvidenceLineLabel();
  const hopText = useHopText();
  const paths = useMemo(() => sortPaths(item.paths), [item.paths]);
  const activeIndex = Math.min(pathIndex, paths.length - 1);
  const path = paths[activeIndex];
  const finalEdge = path?.relationships[path.relationships.length - 1];
  const occurrences = edgeOccurrences(finalEdge);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const activeEvidence =
    occurrences[Math.min(occurrenceIndex, occurrences.length - 1)] ??
    finalEdge?.evidence ??
    null;
  const lineLabel = evidenceLineLabel(activeEvidence);

  return (
    <InsightPanel
      ariaLabel={t("whyLabel", { name: item.dependent.name })}
      title={t("whyTitle")}
      subtitle={item.dependent.qualifiedName}
      closeLabel={t("closeWhy", { name: item.dependent.name })}
      onClose={onClose}
      actions={<CopyValueButton value={item.dependent.qualifiedName} />}
      trail={
        <>
          {path ? (
            <DependencyPathTrail
              path={path}
              highlightedId={analyzedId}
              onOpenObject={onInspectObject}
              onInspectEdge={onInspectEdge}
            />
          ) : (
            <p className="text-sm text-text-secondary">{t("noPath")}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="rounded-full bg-selected px-2.5 py-0.5 font-medium text-primary">
              {path ? hopText(path.hopCount) : null}
            </span>
            {paths.length > 1 && (
              <span aria-live="polite">
                {t("pathsFound", { count: paths.length })}
              </span>
            )}
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </div>
          <OccurrencePicker
            occurrences={occurrences}
            activeIndex={occurrenceIndex}
            onChange={setOccurrenceIndex}
          />
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
              onClick={() => path && onInspectPath(path)}
              disabled={!path}
            >
              <Route aria-hidden /> {t("viewFullPath")}
            </Button>
          </div>
        </>
      }
      evidence={
        <>
          {activeEvidence?.sourceFileId ? (
            <SourceBody
              heading={t("sourceEvidence")}
              compact
              onOpenFullSource={() => onOpenEvidence(activeEvidence)}
              request={{
                kind: "file",
                fileId: activeEvidence.sourceFileId,
                startLine: activeEvidence.startLine ?? undefined,
                endLine: activeEvidence.startLine ?? undefined,
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
