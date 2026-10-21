"use client";

import {
  ArrowRight,
  FileCode2,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type ComponentProps } from "react";
import { getPlsqlHealth } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlHealth,
  PlsqlHealthCategoryName,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError } from "./analysis-error";
import {
  ANALYSIS_PAGE_SIZE,
  AnalysisPageNavigator,
  AnalysisPaginationScope,
} from "./analysis-pagination";
import { usePagedQuery } from "./use-paged-query";
import { cn } from "@/lib/utils";
import {
  edgeOccurrences,
  evidenceLocation,
  RelationshipChip,
  ResolutionBadge,
  useEvidenceLineLabel,
} from "./plsql-atoms";

type SectionStatus = "loading" | "ready" | "error";

const CATEGORY_KEYS = [
  "unresolved",
  "ambiguous",
  "dynamicSql",
  "parseErrors",
  "unsupported",
] as const satisfies readonly PlsqlHealthCategoryName[];

type CategoryKey = (typeof CATEGORY_KEYS)[number];

export function HealthPanel(props: ComponentProps<typeof HealthPanelContent>) {
  return (
    <AnalysisPaginationScope>
      <HealthPanelContent {...props} />
    </AnalysisPaginationScope>
  );
}

function HealthPanelContent({
  objectId,
  onOpenEvidence,
}: {
  objectId?: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const t = useTranslations("plsqlOverview.health");
  const format = useFormatter();
  const [repositoryWide, setRepositoryWide] = useState(!objectId);
  const [openCategory, setOpenCategory] = useState<CategoryKey>("unresolved");
  const [page, setPage] = useState(0);
  const [knownCounts, setKnownCounts] = useState<PlsqlHealth>();

  const scopedId = repositoryWide ? undefined : objectId;
  const healthPage = usePagedQuery({
    listKey: `health|${scopedId ?? ""}|${openCategory}`,
    page,
    fetchPage: (requestedPage) =>
      getPlsqlHealth(scopedId, {
        category: openCategory,
        limit: ANALYSIS_PAGE_SIZE,
        offset: requestedPage * ANALYSIS_PAGE_SIZE,
      }),
  });
  const health = healthPage.data;
  const status: SectionStatus = health
    ? "ready"
    : healthPage.failed
      ? "error"
      : "loading";

  // Every response reports every category's count; keep the last ones while
  // another category loads so the chips never blink.
  useEffect(() => {
    if (health) setKnownCounts(health);
  }, [health]);
  const counted = health ?? knownCounts;

  function selectCategory(next: CategoryKey) {
    setOpenCategory(next);
    setPage(0);
  }

  return (
    <section aria-label={t("region")}>
      {objectId && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={repositoryWide}
            onChange={(event) => {
              setRepositoryWide(event.target.checked);
              setPage(0);
            }}
          />
          {t("repositoryWide")}
        </label>
      )}
      {status === "loading" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError
            code={healthPage.errorCode}
            onRetry={healthPage.retry}
          />
        </div>
      )}
      {counted && (
        <>
          <div
            role="group"
            aria-label={t("categoryGroup")}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {CATEGORY_KEYS.map((key) => {
              const active = key === openCategory;
              const count = counted[key].count;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectCategory(key)}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/30 bg-selected text-primary"
                      : "bg-surface text-text-secondary hover:bg-background",
                    !active && count === 0 && "opacity-60",
                  )}
                >
                  {t(`categories.${key}`)}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                      active ? "bg-surface" : "bg-background",
                    )}
                  >
                    {format.number(count, { useGrouping: "always" })}
                  </span>
                </button>
              );
            })}
          </div>
          {health && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold text-text-secondary">
                {t(`categories.${openCategory}`)}
              </h3>
              {health[openCategory].items.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                  {t("emptyCategory")}
                </p>
              ) : (
                <ul className="mt-2 divide-y overflow-hidden rounded-lg border bg-surface">
                  {health[openCategory].items.map((edge) => (
                    <HealthRow
                      key={edge.id}
                      edge={edge}
                      onOpenEvidence={onOpenEvidence}
                    />
                  ))}
                </ul>
              )}
              {health[openCategory].count > 0 && (
                <AnalysisPageNavigator
                  page={page}
                  pageSize={ANALYSIS_PAGE_SIZE}
                  total={health[openCategory].count}
                  loading={healthPage.refreshing}
                  error={healthPage.failed}
                  onPageChange={setPage}
                  onRetry={healthPage.retry}
                />
              )}
            </div>
          )}
        </>
      )}
      {status === "ready" && health && health.total === 0 && (
        <p className="mt-3 flex items-start gap-2 text-sm text-success">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {t("none")}
        </p>
      )}
    </section>
  );
}

function HealthRow({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const lineLabel = useEvidenceLineLabel();
  const locations = groupByPath(edgeOccurrences(edge));
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RelationshipChip relationship={edge.relationship} />
            <span className="font-medium">{edge.source.qualifiedName}</span>
          </p>
          <p className="flex items-start gap-1.5 text-text-secondary">
            <ArrowRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{edge.target.qualifiedName}</span>
          </p>
        </div>
        <ResolutionBadge resolution={edge.resolution} />
      </div>
      {locations.length === 0 &&
        evidenceLocation(edge.evidence) !== undefined && (
          <p className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
            <FileCode2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {evidenceLocation(edge.evidence)}
          </p>
        )}
      {locations.length > 0 && (
        <ul className="mt-2 space-y-1">
          {locations.map(({ path, occurrences }) => (
            <li
              key={path}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary"
            >
              <FileCode2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 max-w-full truncate" title={path}>
                {path}
              </span>
              {occurrences.map((occurrence) => (
                <button
                  key={`${occurrence.startLine ?? ""}:${occurrence.startOffset ?? ""}`}
                  type="button"
                  title={evidenceLocation(occurrence)}
                  onClick={() => onOpenEvidence(occurrence)}
                  className="rounded border bg-background px-1.5 py-0.5 text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {lineLabel(occurrence)}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One call site per link, grouped under the file that holds them (in order). */
function groupByPath(
  occurrences: PlsqlSourceCoordinate[],
): { path: string; occurrences: PlsqlSourceCoordinate[] }[] {
  const groups = new Map<string, PlsqlSourceCoordinate[]>();
  for (const occurrence of occurrences) {
    if (!occurrence.sourceFileId || !occurrence.path) continue;
    const group = groups.get(occurrence.path) ?? [];
    group.push(occurrence);
    groups.set(occurrence.path, group);
  }
  return [...groups].map(([path, grouped]) => ({ path, occurrences: grouped }));
}
