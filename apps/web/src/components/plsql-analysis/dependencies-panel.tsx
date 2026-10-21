"use client";

import { LoaderCircle, Route } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { getPlsqlDependencies } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlDependencySummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
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
import { dependencyToPath, DependencyPathTrail } from "./dependency-path-trail";
import {
  ObjectCell,
  PackageCell,
  useEvidenceLineLabel,
  edgeOccurrences,
  OccurrencePicker,
  RelationshipChip,
  ResolutionBadge,
  EvidenceCell,
} from "./plsql-atoms";
import { CopyValueButton } from "./copy-value-button";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";
import { packageKeyOf } from "./package-grouping";
import { SourceBody } from "./source-viewer";
import { StickyBar } from "./sticky-bar";
import { usePagedQuery } from "./use-paged-query";

type SectionStatus = "loading" | "ready" | "error";

const CATEGORIES: { value: PlsqlDependencyCategory }[] = [
  { value: "callers" },
  { value: "callees" },
  { value: "reads" },
  { value: "writes" },
  { value: "other" },
];

/** One compact result row: the edge plus whichever endpoint isn't the analyzed object. */
type DependencyListRow = {
  id: string;
  other: PlsqlObjectReference;
  edge: PlsqlDependency;
};

export function DependenciesPanel(
  props: ComponentProps<typeof DependenciesPanelContent>,
) {
  return (
    <AnalysisPaginationScope>
      <DependenciesPanelContent {...props} />
    </AnalysisPaginationScope>
  );
}

function DependenciesPanelContent({
  object,
  initialCategory,
  groupByPackage,
  onOpenEvidence,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
}: {
  object: PlsqlObject;
  /** Category selected on first render, e.g. arriving from Overview's "View all in Dependencies". */
  initialCategory?: PlsqlDependencyCategory;
  /** Files the rows under collapsible package headers. */
  groupByPackage: boolean;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  /** Source/target chips in the selected-dependency trail inspect in place instead,
   * matching the Paths view: navigating away would reset this panel back to
   * its default category (see the objectId-keyed reset effect above). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  /** "Analyze impact" contextual action for the selected dependency's other object. */
  /** "View full path" contextual action: shows the one-hop edge as a path in the Inspector. */
  onInspectPath?: (path: PlsqlPath) => void;
}) {
  const t = useTranslations("plsqlDependencies");
  const objectId = object.id;
  const [category, setCategory] = useState<PlsqlDependencyCategory>(
    initialCategory ?? "callers",
  );
  const [page, setPage] = useState(0);
  const [knownCounts, setKnownCounts] = useState<{
    objectId: string;
    counts: PlsqlDependencySummary["counts"];
  }>();
  const [selectedEdge, setSelectedEdge] = useState<PlsqlDependency>();
  // A view grouped by package reads its list in package order, so paging goes
  // through the packages alphabetically; flipping it re-reads from page 1.
  const order = groupByPackage ? "package" : "name";
  const dependencyPage = usePagedQuery({
    listKey: `dependencies|${objectId}|${category}|${order}`,
    page,
    fetchPage: (requestedPage) =>
      getPlsqlDependencies(objectId, category, {
        limit: ANALYSIS_PAGE_SIZE,
        offset: requestedPage * ANALYSIS_PAGE_SIZE,
        order,
      }),
  });
  const activeSummary = dependencyPage.data;
  const status: SectionStatus = activeSummary
    ? "ready"
    : dependencyPage.failed
      ? "error"
      : "loading";

  // Reset per-object state so lists never mix two objects.
  useEffect(() => {
    setCategory(initialCategory ?? "callers");
    setSelectedEdge(undefined);
    setPage(0);
  }, [objectId, initialCategory]);

  // Every response carries every category's counts; keep them while another
  // category loads so the chips never blink.
  useEffect(() => {
    if (activeSummary) {
      setKnownCounts({ objectId, counts: activeSummary.counts });
    }
  }, [objectId, activeSummary]);
  const counts =
    knownCounts?.objectId === objectId ? knownCounts.counts : undefined;

  useEffect(() => {
    setPage(0);
    setSelectedEdge(undefined);
  }, [groupByPackage]);

  function selectCategory(next: PlsqlDependencyCategory) {
    setCategory(next);
    setSelectedEdge(undefined);
    setPage(0);
  }

  function changePage(next: number) {
    setPage(next);
    setSelectedEdge(undefined);
  }

  function selectEdge(edge: PlsqlDependency) {
    onInspectEdge?.(edge);
    setSelectedEdge((current) => (current?.id === edge.id ? undefined : edge));
  }

  const rows: DependencyListRow[] = (activeSummary?.items ?? []).map(
    (edge) => ({
      id: edge.id,
      other: edge.source.id === objectId ? edge.target : edge.source,
      edge,
    }),
  );

  const compact = selectedEdge !== undefined;
  const objectColumn: DetailTableColumn<DependencyListRow> = {
    header: t("columns.relatedObject"),
    cell: (row) => <ObjectCell reference={row.other} compact={compact} />,
  };
  const packageColumn: DetailTableColumn<DependencyListRow> = {
    header: t("columns.package"),
    cell: (row) => <PackageCell reference={row.other} />,
  };
  const relationshipColumn: DetailTableColumn<DependencyListRow> = {
    header: t("columns.relationship"),
    cell: (row) => <RelationshipChip relationship={row.edge.relationship} />,
  };
  const resolutionColumn: DetailTableColumn<DependencyListRow> = {
    header: t("columns.resolution"),
    cell: (row) => <ResolutionBadge resolution={row.edge.resolution} />,
  };
  const evidenceColumn: DetailTableColumn<DependencyListRow> = {
    header: t("columns.evidence"),
    cell: (row) => (
      <EvidenceCell edge={row.edge} onSelect={() => selectEdge(row.edge)} />
    ),
  };
  const columns = compact
    ? [objectColumn, relationshipColumn, resolutionColumn, evidenceColumn]
    : [
        objectColumn,
        packageColumn,
        relationshipColumn,
        resolutionColumn,
        evidenceColumn,
      ];

  return (
    <section aria-label={t("panel.ariaLabel")}>
      <StickyBar>
        <div
          role="group"
          aria-label={t("panel.categoryGroup")}
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
                onClick={() => selectCategory(entry.value)}
                className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
                  active
                    ? "border-transparent bg-selected text-primary"
                    : "bg-surface text-text-secondary hover:bg-background"
                }`}
              >
                {t(`categories.${entry.value}`)}
                {count !== undefined && (
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </StickyBar>

      {status === "loading" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          {t("panel.loading")}
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError
            code={dependencyPage.errorCode}
            onRetry={dependencyPage.retry}
          />
        </div>
      )}

      <ListDetailSplit
        stickyTop="top-14"
        list={
          <>
            {activeSummary && (
              <section
                aria-label={t("panel.resultsHeading")}
                className="mt-3 rounded-lg border bg-surface"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <h3 className="text-sm font-semibold text-text-secondary">
                    {t("panel.resultsHeading")}
                  </h3>
                </div>
                <DependencyDetailTable
                  ariaLabel={t("panel.tableLabel", {
                    category: t(`categories.${category}`),
                  })}
                  columns={columns}
                  rows={rows}
                  getRowId={(row) => row.id}
                  selectedId={selectedEdge?.id}
                  onSelectRow={(row) => selectEdge(row.edge)}
                  emptyMessage={t("panel.empty")}
                  bordered={false}
                  groupKey={
                    groupByPackage
                      ? (row) => packageKeyOf(row.other)
                      : undefined
                  }
                />
                {activeSummary.total > 0 && (
                  <AnalysisPageNavigator
                    page={page}
                    pageSize={ANALYSIS_PAGE_SIZE}
                    total={activeSummary.total}
                    loading={dependencyPage.refreshing}
                    error={dependencyPage.failed}
                    onPageChange={changePage}
                    onRetry={dependencyPage.retry}
                  />
                )}
              </section>
            )}
          </>
        }
        detail={
          status === "ready" &&
          selectedEdge && (
            <SelectedDependency
              key={selectedEdge.id}
              edge={selectedEdge}
              objectId={objectId}
              onClose={() => setSelectedEdge(undefined)}
              onInspectObject={onInspectObject}
              onInspectEdge={onInspectEdge}
              onInspectPath={onInspectPath}
              onOpenEvidence={onOpenEvidence}
            />
          )
        }
      />
    </section>
  );
}

function SelectedDependency({
  edge,
  objectId,
  onClose,
  onInspectObject,
  onInspectEdge,
  onInspectPath,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  objectId: string;
  onClose: () => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onInspectPath?: (path: PlsqlPath) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const t = useTranslations("plsqlDependencies");
  const evidenceLineLabel = useEvidenceLineLabel();
  const other = edge.source.id === objectId ? edge.target : edge.source;
  const occurrences = edgeOccurrences(edge);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const evidence =
    occurrences[Math.min(occurrenceIndex, occurrences.length - 1)] ??
    edge.evidence;
  const lineLabel = evidenceLineLabel(evidence);
  // A single edge is a one-hop path, so it reuses the same trail the
  // Impact and Paths views use to explain a chain of relationships.
  const path = dependencyToPath(edge);

  return (
    <InsightPanel
      ariaLabel={t("selected.title")}
      title={t("selected.title")}
      closeLabel={t("selected.close")}
      onClose={onClose}
      actions={<CopyValueButton value={other.qualifiedName} />}
      trail={
        <>
          <DependencyPathTrail
            path={path}
            onOpenObject={onInspectObject}
            onInspectEdge={onInspectEdge}
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
          <OccurrencePicker
            occurrences={occurrences}
            activeIndex={occurrenceIndex}
            onChange={setOccurrenceIndex}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onInspectPath && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onInspectPath({ id: edge.id, ...path, hopCount: 1 })
                }
              >
                <Route aria-hidden /> {t("selected.viewFullPath")}
              </Button>
            )}
          </div>
        </>
      }
      evidence={
        <>
          {evidence?.sourceFileId ? (
            <SourceBody
              heading={t("selected.sourceEvidence")}
              compact
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
              {t("selected.noEvidence")}
            </p>
          )}
        </>
      }
    />
  );
}
