"use client";

import { ArrowRight, LoaderCircle, Route } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlImpactSummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { AnalysisError } from "./analysis-error";
import {
  ANALYSIS_PAGE_SIZE,
  AnalysisPageNavigator,
  AnalysisPaginationScope,
} from "./analysis-pagination";
import {
  DependencyDetailTable,
  type DetailTableColumn,
} from "./dependency-detail-table";
import {
  dependencyToPath,
  DependencyPathTrail,
  type PathLike,
} from "./dependency-path-trail";
import { ImpactMetricCard, MetricBar } from "./impact-metric-card";
import { useImpactSummary } from "./use-impact-summary";
import {
  useOverviewCardTotals,
  useOverviewRows,
  type OverviewCardTotals,
  type OverviewRowsPage,
} from "./use-overview-data";
import { packageKeyOf } from "./package-grouping";
import {
  DEFAULT_IMPACT_DEPTH,
  DepthField,
  FALLBACK_MAX_DEPTH,
} from "./impact-report";
import {
  overviewMetricsForKind,
  type OverviewMetricDef,
} from "./overview-metrics";
import {
  ObjectCell,
  PackageCell,
  ObjectKindBadge,
  useEvidenceLineLabel,
  edgeOccurrences,
  OccurrencePicker,
  useHopText,
  EvidenceCell,
} from "./plsql-atoms";
import { CopyValueButton } from "./copy-value-button";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";
import { SourceBody } from "./source-viewer";

type SectionStatus = "loading" | "ready" | "error";

/** One detail-table row, normalized from either an impact item or a raw dependency edge. */
type OverviewDetailRow = {
  id: string;
  subject: PlsqlObjectReference;
  relationship?: string;
  distance?: number;
  path: PathLike;
  hopCount: number;
  fullPath: PlsqlPath;
};

export function OverviewPanel(
  props: ComponentProps<typeof OverviewPanelContent>,
) {
  return (
    <AnalysisPaginationScope>
      <OverviewPanelContent {...props} />
    </AnalysisPaginationScope>
  );
}

function OverviewPanelContent({
  object,
  groupByPackage,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onExploreDependencies,
  onExploreImpact,
}: {
  object: PlsqlObject;
  /** Files the detail rows under collapsible package headers. */
  groupByPackage: boolean;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  /** The "Why is this affected?" trail inspects in place instead, matching
   * the Dependencies/Impact/Paths views: navigating away would discard the
   * selected metric row. */
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onExploreDependencies: (category: PlsqlDependencyCategory) => void;
  onExploreImpact: () => void;
}) {
  const t = useTranslations("plsqlOverview.overview");
  const objectId = object.id;
  const objectKind = object.kind;
  const headingId = "plsql-overview-heading";

  const [selectedMetricKey, setSelectedMetricKey] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string>();
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [depth, setDepth] = useState(DEFAULT_IMPACT_DEPTH);
  const maxDepth = useAuth().config.plsqlMaxHops ?? FALLBACK_MAX_DEPTH;
  const { metrics, impactRelationship } = overviewMetricsForKind(objectKind);
  const metric =
    metrics.find((entry) => entry.key === selectedMetricKey) ?? metrics[0];

  // Card numbers and the selected card's rows are separate services: the
  // impact totals, the dependency counts and one server-side page of rows
  // each load and fail on their own.
  const impactSummary = useImpactSummary({
    objectId,
    relationship: impactRelationship,
    depth,
    attempt,
  });
  const cardTotals = useOverviewCardTotals(objectId, metrics, attempt);
  const rows = useOverviewRows({
    objectId,
    metric,
    page,
    depth,
    impactRelationship,
    order: groupByPackage ? "package" : "name",
  });
  const status: SectionStatus = cardTotals.errorCode
    ? "error"
    : cardTotals.totals
      ? "ready"
      : "loading";

  useEffect(() => {
    setSelectedMetricKey(overviewMetricsForKind(objectKind).metrics[0].key);
    setSelectedRowId(undefined);
    setPage(0);
  }, [objectId, objectKind]);

  // Grouping by package re-reads the list in package order; start from page 1.
  useEffect(() => {
    setPage(0);
    setSelectedRowId(undefined);
  }, [groupByPackage]);

  function selectMetric(next: OverviewMetricDef) {
    setSelectedMetricKey(next.key);
    setSelectedRowId(undefined);
    setPage(0);
  }

  function changeDepth(next: number) {
    setDepth(next);
    setSelectedRowId(undefined);
    setPage(0);
  }

  function changePage(next: number) {
    setPage(next);
    setSelectedRowId(undefined);
  }

  function toggleRow(id: string) {
    setSelectedRowId((current) => (current === id ? undefined : id));
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="text-xl font-semibold">
          {t("heading")}
        </h2>
        <DepthField
          depth={depth}
          maxDepth={maxDepth}
          layout="inline"
          onChange={changeDepth}
        />
      </div>
      {status === "loading" && (
        <div role="status" className="mt-3">
          <span className="sr-only">{t("loading")}</span>
          <div
            aria-hidden
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-[4.5rem]" />
            ))}
          </div>
        </div>
      )}
      {status === "error" && (
        <AnalysisError
          code={cardTotals.errorCode}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      )}
      {status === "ready" && cardTotals.totals && (
        <OverviewBody
          object={object}
          groupByPackage={groupByPackage}
          impactSummary={impactSummary}
          cardTotals={cardTotals.totals}
          metric={metric}
          rows={rows}
          page={page}
          selectedRowId={selectedRowId}
          onSelectMetric={selectMetric}
          onPageChange={changePage}
          onSelectRowId={toggleRow}
          onOpenEvidence={onOpenEvidence}
          onInspectObject={onInspectObject}
          onInspectEdge={onInspectEdge}
          onInspectPath={onInspectPath}
          onExploreDependencies={onExploreDependencies}
          onExploreImpact={onExploreImpact}
        />
      )}
    </section>
  );
}

function OverviewBody({
  object,
  groupByPackage,
  impactSummary,
  cardTotals,
  metric,
  rows: rowsQuery,
  page,
  selectedRowId,
  onSelectMetric,
  onPageChange,
  onSelectRowId,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onExploreDependencies,
  onExploreImpact,
}: {
  object: PlsqlObject;
  groupByPackage: boolean;
  impactSummary: ReturnType<typeof useImpactSummary>;
  cardTotals: OverviewCardTotals;
  metric: OverviewMetricDef;
  /** The selected card's rows: one server-side page at a time. */
  rows: ReturnType<typeof useOverviewRows>;
  page: number;
  selectedRowId?: string;
  onSelectMetric: (metric: OverviewMetricDef) => void;
  onPageChange: (page: number) => void;
  onSelectRowId: (id: string) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onExploreDependencies: (category: PlsqlDependencyCategory) => void;
  onExploreImpact: () => void;
}) {
  const t = useTranslations("plsqlOverview");
  const { metrics } = overviewMetricsForKind(object.kind);
  const columns = useDetailColumns();
  const rows = useMemo(
    () => rowsForPage(object, rowsQuery.data),
    [object, rowsQuery.data],
  );
  const loaded = rowsQuery.data !== undefined;
  const selectedRow = rows.find((row) => row.id === selectedRowId);

  return (
    <div className="mt-3">
      {impactSummary.errorCode && (
        <div className="mb-3">
          <AnalysisError
            code={impactSummary.errorCode}
            onRetry={impactSummary.retry}
          />
        </div>
      )}
      <MetricBar
        ariaLabel={t("overview.metricsGroup")}
        columns="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {metrics.map((entry) => (
          <ImpactMetricCard
            key={entry.key}
            value={metricValue(entry, impactSummary.summary, cardTotals)}
            label={t(`metrics.${entry.key}.label`)}
            active={entry.key === metric.key}
            onSelect={() => onSelectMetric(entry)}
          />
        ))}
      </MetricBar>
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-secondary">
            {t(`metrics.${metric.key}.label`)}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              metric.source.kind === "dependency"
                ? onExploreDependencies(metric.source.category)
                : onExploreImpact()
            }
          >
            {metric.source.kind === "dependency"
              ? t("overview.viewAllDependencies")
              : t("overview.viewAllImpact")}{" "}
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <div className="mt-2">
          <ListDetailSplit
            stickyTop="top-[4.5rem]"
            list={
              <>
                {!loaded && rowsQuery.failed ? (
                  <div className="mt-2">
                    <AnalysisError onRetry={rowsQuery.retry} />
                  </div>
                ) : !loaded ? (
                  <p
                    role="status"
                    className="mt-2 flex items-center gap-2 text-sm text-text-secondary"
                  >
                    <LoaderCircle
                      aria-hidden
                      className="h-4 w-4 animate-spin"
                    />
                    {t("overview.loadingRows")}
                  </p>
                ) : (
                  <>
                    <div
                      className={cn(
                        "mt-2 transition-opacity",
                        rowsQuery.refreshing && "opacity-60",
                      )}
                    >
                      <DependencyDetailTable
                        ariaLabel={t(`metrics.${metric.key}.label`)}
                        columns={columns(
                          metric,
                          (row) => onSelectRowId(row.id),
                          selectedRow !== undefined,
                        )}
                        rows={rows}
                        getRowId={(row) => row.id}
                        selectedId={selectedRowId}
                        onSelectRow={(row) => onSelectRowId(row.id)}
                        emptyMessage={t(`metrics.${metric.key}.empty`)}
                        groupKey={
                          groupByPackage
                            ? (row) => packageKeyOf(row.subject)
                            : undefined
                        }
                      />
                    </div>
                    {rowsQuery.data && rowsQuery.data.total > 0 && (
                      <AnalysisPageNavigator
                        page={page}
                        pageSize={ANALYSIS_PAGE_SIZE}
                        total={rowsQuery.data.total}
                        loading={rowsQuery.refreshing}
                        error={rowsQuery.failed}
                        onPageChange={onPageChange}
                        onRetry={rowsQuery.retry}
                      />
                    )}
                  </>
                )}
              </>
            }
            detail={
              selectedRow && (
                <RelationshipInsight
                  key={selectedRow.id}
                  row={selectedRow}
                  onClose={() => onSelectRowId(selectedRow.id)}
                  onOpenEvidence={onOpenEvidence}
                  onInspectObject={onInspectObject}
                  onInspectEdge={onInspectEdge}
                  onInspectPath={onInspectPath}
                />
              )
            }
          />
        </div>
      </section>
    </div>
  );
}

type DetailColumnsFor = (
  metric: OverviewMetricDef,
  onSelectRow: (row: OverviewDetailRow) => void,
  compact: boolean,
) => DetailTableColumn<OverviewDetailRow>[];

function useDetailColumns(): DetailColumnsFor {
  const t = useTranslations("plsqlOverview");
  const hopText = useHopText();
  return (metric, onSelectRow, compact) =>
    buildColumns(metric, onSelectRow, { t, hopText }, compact);
}

type ColumnText = {
  t: ReturnType<typeof useTranslations<"plsqlOverview">>;
  hopText: (distance: number) => string;
};

function buildColumns(
  metric: OverviewMetricDef,
  onSelectRow: (row: OverviewDetailRow) => void,
  { t, hopText }: ColumnText,
  compact: boolean,
): DetailTableColumn<OverviewDetailRow>[] {
  const subjectColumn: DetailTableColumn<OverviewDetailRow> = {
    header: t(`metrics.subject.${metric.subjectColumnHeader}`),
    cell: (row) => <ObjectCell reference={row.subject} compact={compact} />,
  };
  const packageColumn: DetailTableColumn<OverviewDetailRow> = {
    header: t("overview.columns.package"),
    cell: (row) => <PackageCell reference={row.subject} />,
  };
  const typeColumn: DetailTableColumn<OverviewDetailRow> = {
    header: t("overview.columns.type"),
    cell: (row) => <ObjectKindBadge kind={row.subject.kind} />,
  };
  const lastColumn: DetailTableColumn<OverviewDetailRow> =
    metric.columns === "distance"
      ? {
          header: t("overview.columns.distance"),
          align: "right",
          cell: (row) => hopText(row.distance ?? 0),
        }
      : {
          header:
            metric.columns === "operation"
              ? t("overview.columns.operation")
              : t("overview.columns.relationship"),
          cell: (row) => row.relationship ?? "—",
        };
  const evidenceColumn: DetailTableColumn<OverviewDetailRow> = {
    header: t("overview.columns.evidence"),
    cell: (row) => (
      <EvidenceCell
        edge={row.path.relationships[row.path.relationships.length - 1]}
        onSelect={() => onSelectRow(row)}
      />
    ),
  };
  return compact
    ? [subjectColumn, lastColumn, evidenceColumn]
    : [subjectColumn, packageColumn, typeColumn, lastColumn, evidenceColumn];
}

function metricValue(
  metric: OverviewMetricDef,
  impact: PlsqlImpactSummary | undefined,
  totals: OverviewCardTotals,
): number | undefined {
  if (metric.source.kind === "impact") {
    if (!impact) return undefined;
    return metric.source.scope === "direct" ? impact.direct : impact.indirect;
  }
  return metric.source.onlyRelationship
    ? totals.narrowed[metric.key]
    : totals.counts[metric.source.category];
}

/** Normalizes one page of impact items or dependency edges into detail rows. */
function rowsForPage(
  object: PlsqlObject,
  page: OverviewRowsPage | undefined,
): OverviewDetailRow[] {
  if (!page) return [];
  if (page.kind === "impact") {
    return page.items
      .filter((item) => item.paths.length > 0)
      .map((item): OverviewDetailRow => {
        const path = item.paths[0];
        return {
          id: item.id,
          subject: item.dependent,
          distance: item.distance,
          relationship: path.relationships[0]?.relationship,
          path,
          hopCount: path.hopCount,
          fullPath: path,
        };
      });
  }
  return page.edges.map((edge): OverviewDetailRow => {
    const subject = edge.source.id === object.id ? edge.target : edge.source;
    const path = dependencyToPath(edge);
    return {
      id: edge.id,
      subject,
      relationship: edge.relationship,
      path,
      hopCount: 1,
      fullPath: { id: edge.id, ...path, hopCount: 1 },
    };
  });
}

function RelationshipInsight({
  row,
  onClose,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  row: OverviewDetailRow;
  onClose: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
}) {
  const t = useTranslations("plsqlOverview.overview.why");
  const tInsight = useTranslations("plsqlOverview.insight");
  const hopText = useHopText();
  const evidenceLineLabel = useEvidenceLineLabel();
  const finalEdge = row.path.relationships[row.path.relationships.length - 1];
  const occurrences = edgeOccurrences(finalEdge);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const activeEvidence =
    occurrences[Math.min(occurrenceIndex, occurrences.length - 1)] ??
    finalEdge?.evidence ??
    null;
  const lineLabel = evidenceLineLabel(activeEvidence);

  return (
    <InsightPanel
      ariaLabel={t("region", { name: row.subject.name })}
      title={t("title")}
      subtitle={row.subject.qualifiedName}
      closeLabel={t("close", { name: row.subject.name })}
      onClose={onClose}
      actions={<CopyValueButton value={row.subject.qualifiedName} />}
      trail={
        <>
          <DependencyPathTrail
            path={row.path}
            onOpenObject={onInspectObject}
            onInspectEdge={onInspectEdge}
          />
          {/* The full path/line already appears once, in the source evidence
           * header on the right. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="rounded-full bg-selected px-2.5 py-0.5 font-medium text-primary">
              {hopText(row.hopCount)}
            </span>
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </div>
          <OccurrencePicker
            occurrences={occurrences}
            activeIndex={occurrenceIndex}
            onChange={setOccurrenceIndex}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInspectPath(row.fullPath)}
            >
              <Route aria-hidden /> {t("viewPath")}
            </Button>
          </div>
        </>
      }
      evidence={
        <>
          {activeEvidence?.sourceFileId ? (
            <SourceBody
              heading={tInsight("sourceEvidence")}
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
