"use client";

import { ArrowRight, Copy, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getPlsqlDependencies,
  getPlsqlImpact,
  type PlsqlProblemCode,
} from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlDependencySummary,
  PlsqlImpactResult,
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
  dependencyToPath,
  DependencyPathTrail,
  type PathLike,
} from "./dependency-path-trail";
import { ImpactMetricCard } from "./impact-metric-card";
import { sortImpactItems } from "./impact-report";
import {
  firstDependencyCategory,
  overviewMetricsForKind,
  type OverviewMetricDef,
} from "./overview-metrics";
import {
  displayPackageOf,
  evidenceLineLabel,
  evidenceLocation,
  hopText,
  ObjectKindBadge,
} from "./plsql-atoms";
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

export function OverviewPanel({
  object,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onAnalyzeObject,
  onExploreDependencies,
  onExploreImpact,
}: {
  object: PlsqlObject;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  /** The "Why is this affected?" trail inspects in place instead, matching
   * the Dependencies/Impact/Paths views: navigating away would discard the
   * selected metric row. */
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onAnalyzeObject: (reference: PlsqlObjectReference) => void;
  onExploreDependencies: (category: PlsqlDependencyCategory) => void;
  onExploreImpact: () => void;
}) {
  const objectId = object.id;
  const objectKind = object.kind;
  const headingId = "plsql-overview-heading";

  const [selectedMetricKey, setSelectedMetricKey] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string>();
  const [impact, setImpact] = useState<PlsqlImpactResult>();
  const [pages, setPages] = useState<
    Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>
  >({});
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [attempt, setAttempt] = useState(0);

  // Baseline load: the impact summary (direct + indirect, any relationship
  // this kind cares about) and one dependency category, which returns every
  // category's counts in one response. Together these cover every metric's
  // card number and the default-selected metric's rows for every kind.
  useEffect(() => {
    let cancelled = false;
    const config = overviewMetricsForKind(objectKind);
    const category = firstDependencyCategory(config.metrics);

    setSelectedMetricKey(config.metrics[0].key);
    setSelectedRowId(undefined);
    setPages({});
    setImpact(undefined);
    setStatus("loading");
    setErrorCode(undefined);

    Promise.all([
      getPlsqlImpact(objectId, {
        direction: "upstream",
        relationship: config.impactRelationship,
      }),
      category ? getPlsqlDependencies(objectId, category) : undefined,
    ])
      .then(([impactValue, depsValue]) => {
        if (cancelled) return;
        if (!impactValue) throw new Error("Object not found");
        setImpact(impactValue);
        if (category && depsValue) setPages({ [category]: depsValue });
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
  }, [objectId, objectKind, attempt]);

  function ensureCategory(category: PlsqlDependencyCategory) {
    if (pages[category]) return;
    getPlsqlDependencies(objectId, category).then((value) => {
      setPages((prev) => ({ ...prev, [category]: value }));
    });
  }

  function selectMetric(metric: OverviewMetricDef) {
    setSelectedMetricKey(metric.key);
    setSelectedRowId(undefined);
    if (metric.source.kind === "dependency")
      ensureCategory(metric.source.category);
  }

  function toggleRow(id: string) {
    setSelectedRowId((current) => (current === id ? undefined : id));
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        Potential impact
      </h2>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading overview…
        </p>
      )}
      {status === "error" && (
        <AnalysisError
          code={errorCode}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      )}
      {status === "ready" && (
        <OverviewBody
          object={object}
          impact={impact}
          pages={pages}
          selectedMetricKey={selectedMetricKey}
          selectedRowId={selectedRowId}
          onSelectMetric={selectMetric}
          onSelectRowId={toggleRow}
          onOpenEvidence={onOpenEvidence}
          onOpenObject={onOpenObject}
          onInspectObject={onInspectObject}
          onInspectEdge={onInspectEdge}
          onInspectPath={onInspectPath}
          onAnalyzeObject={onAnalyzeObject}
          onExploreDependencies={onExploreDependencies}
          onExploreImpact={onExploreImpact}
        />
      )}
    </section>
  );
}

function OverviewBody({
  object,
  impact,
  pages,
  selectedMetricKey,
  selectedRowId,
  onSelectMetric,
  onSelectRowId,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onAnalyzeObject,
  onExploreDependencies,
  onExploreImpact,
}: {
  object: PlsqlObject;
  impact?: PlsqlImpactResult;
  pages: Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>;
  selectedMetricKey: string;
  selectedRowId?: string;
  onSelectMetric: (metric: OverviewMetricDef) => void;
  onSelectRowId: (id: string) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onAnalyzeObject: (reference: PlsqlObjectReference) => void;
  onExploreDependencies: (category: PlsqlDependencyCategory) => void;
  onExploreImpact: () => void;
}) {
  const { metrics } = overviewMetricsForKind(object.kind);
  const metric =
    metrics.find((entry) => entry.key === selectedMetricKey) ?? metrics[0];
  const { rows, truncated, loaded } = rowsForMetric(
    metric,
    object,
    impact,
    pages,
  );
  const selectedRow = rows.find((row) => row.id === selectedRowId);
  const counts = dependencyCounts(pages);

  return (
    <div className="mt-3">
      <div
        role="group"
        aria-label="Overview metrics"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {metrics.map((entry) => (
          <ImpactMetricCard
            key={entry.key}
            value={metricValue(entry, impact, pages, counts)}
            label={entry.label}
            active={entry.key === metric.key}
            onSelect={() => onSelectMetric(entry)}
          />
        ))}
      </div>
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-secondary">
            {metric.label}
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
              ? "View all in Dependencies"
              : "View all in Impact"}{" "}
            <ArrowRight aria-hidden />
          </Button>
        </div>
        {!loaded ? (
          <p
            role="status"
            className="mt-2 flex items-center gap-2 text-sm text-text-secondary"
          >
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : (
          <>
            {truncated && (
              <p className="mt-2 text-xs text-warning">Results truncated</p>
            )}
            <div className="mt-2">
              <DependencyDetailTable
                ariaLabel={metric.label}
                columns={columnsFor(metric, (row) => onSelectRowId(row.id))}
                rows={rows}
                getRowId={(row) => row.id}
                selectedId={selectedRowId}
                onSelectRow={(row) => onSelectRowId(row.id)}
                emptyMessage={metric.emptyMessage}
              />
            </div>
          </>
        )}
        {selectedRow && (
          <RelationshipInsight
            row={selectedRow}
            onClose={() => onSelectRowId(selectedRow.id)}
            onOpenEvidence={onOpenEvidence}
            onOpenObject={onOpenObject}
            onInspectObject={onInspectObject}
            onInspectEdge={onInspectEdge}
            onInspectPath={onInspectPath}
            onAnalyzeObject={onAnalyzeObject}
          />
        )}
      </section>
    </div>
  );
}

function columnsFor(
  metric: OverviewMetricDef,
  onSelectRow: (row: OverviewDetailRow) => void,
): DetailTableColumn<OverviewDetailRow>[] {
  const subjectColumn: DetailTableColumn<OverviewDetailRow> = {
    header: metric.subjectColumnHeader,
    cell: (row) => (
      <span
        title={row.subject.qualifiedName}
        className="break-words font-medium"
      >
        {row.subject.name}
      </span>
    ),
  };
  const packageColumn: DetailTableColumn<OverviewDetailRow> = {
    header: "Package",
    cell: (row) =>
      displayPackageOf(row.subject) ?? (
        <span className="text-text-muted">—</span>
      ),
  };
  const typeColumn: DetailTableColumn<OverviewDetailRow> = {
    header: "Type",
    cell: (row) => <ObjectKindBadge kind={row.subject.kind} />,
  };
  const lastColumn: DetailTableColumn<OverviewDetailRow> =
    metric.columns === "distance"
      ? {
          header: "Distance",
          align: "right",
          cell: (row) => hopText(row.distance ?? 0),
        }
      : {
          header: metric.columns === "operation" ? "Operation" : "Relationship",
          cell: (row) => row.relationship ?? "—",
        };
  const evidenceColumn: DetailTableColumn<OverviewDetailRow> = {
    header: "Evidence",
    cell: (row) => {
      const finalEdge =
        row.path.relationships[row.path.relationships.length - 1];
      const evidence = finalEdge?.evidence ?? null;
      const label = evidenceLineLabel(evidence);
      if (label === undefined) {
        return <span className="text-text-muted">—</span>;
      }
      const fullLocation = evidenceLocation(evidence);
      if (!evidence?.sourceFileId) {
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
            onSelectRow(row);
          }}
          className="break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {label}
        </button>
      );
    },
  };
  return [subjectColumn, packageColumn, typeColumn, lastColumn, evidenceColumn];
}

/** Every loaded page carries every category's counts; the first one found suffices. */
function dependencyCounts(
  pages: Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>,
): PlsqlDependencySummary["counts"] | undefined {
  for (const page of Object.values(pages)) {
    if (page) return page.counts;
  }
  return undefined;
}

function metricValue(
  metric: OverviewMetricDef,
  impact: PlsqlImpactResult | undefined,
  pages: Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>,
  counts: PlsqlDependencySummary["counts"] | undefined,
): number {
  if (metric.source.kind === "impact") {
    if (!impact) return 0;
    return metric.source.scope === "direct"
      ? impact.summary.direct
      : impact.summary.indirect;
  }
  const page = pages[metric.source.category];
  const onlyRelationship = metric.source.onlyRelationship;
  if (onlyRelationship && page && !page.truncated) {
    return page.items.filter((edge) => edge.relationship === onlyRelationship)
      .length;
  }
  return counts?.[metric.source.category] ?? 0;
}

function rowsForMetric(
  metric: OverviewMetricDef,
  object: PlsqlObject,
  impact: PlsqlImpactResult | undefined,
  pages: Partial<Record<PlsqlDependencyCategory, PlsqlDependencySummary>>,
): { rows: OverviewDetailRow[]; truncated: boolean; loaded: boolean } {
  if (metric.source.kind === "impact") {
    if (!impact) return { rows: [], truncated: false, loaded: false };
    const scope = metric.source.scope;
    const filtered = impact.items.filter((item) =>
      scope === "direct" ? item.distance === 1 : item.distance > 1,
    );
    const rows = sortImpactItems(filtered)
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
    return { rows, truncated: impact.truncated, loaded: true };
  }
  const page = pages[metric.source.category];
  if (!page) return { rows: [], truncated: false, loaded: false };
  const onlyRelationship = metric.source.onlyRelationship;
  const edges = onlyRelationship
    ? page.items.filter((edge) => edge.relationship === onlyRelationship)
    : page.items;
  const rows = edges.map((edge): OverviewDetailRow => {
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
  return { rows, truncated: page.truncated, loaded: true };
}

function RelationshipInsight({
  row,
  onClose,
  onOpenEvidence,
  onOpenObject,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onAnalyzeObject,
}: {
  row: OverviewDetailRow;
  onClose: () => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onInspectObject?: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath: (path: PlsqlPath) => void;
  onAnalyzeObject: (reference: PlsqlObjectReference) => void;
}) {
  const finalEdge = row.path.relationships[row.path.relationships.length - 1];
  const lineLabel = evidenceLineLabel(finalEdge?.evidence);
  const [copied, setCopied] = useState(false);

  async function copyQualifiedName() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(row.subject.qualifiedName);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-label={`Why ${row.subject.name} is related`}
      className="mt-6 rounded-lg border bg-background"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-text-secondary">
            Why is this affected?
          </h4>
          <span
            title={row.subject.qualifiedName}
            className="break-words text-xs text-text-muted"
          >
            {row.subject.qualifiedName}
          </span>
        </div>
        <button
          type="button"
          aria-label={`Close why ${row.subject.name} is related`}
          onClick={onClose}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-text-secondary hover:bg-selected hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="grid items-start divide-y lg:grid-cols-[35%_1fr] lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <DependencyPathTrail
            path={row.path}
            onOpenObject={onInspectObject}
            onInspectEdge={onInspectEdge}
            showKind
          />
          {/* The full path/line already appears once, in the source evidence
           * header on the right. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">
              {hopText(row.hopCount)}
            </span>
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenObject(row.subject)}
            >
              Open object
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Analyze impact for ${row.subject.name}`}
              onClick={() => onAnalyzeObject(row.subject)}
            >
              Analyze impact
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onInspectPath(row.fullPath)}
            >
              View path
            </Button>
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
          {finalEdge?.evidence?.sourceFileId ? (
            <SourceBody
              heading="Source evidence"
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
              No source evidence available for this relationship.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
