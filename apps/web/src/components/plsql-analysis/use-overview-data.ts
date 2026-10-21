"use client";

import useSWR from "swr";
import { getPlsqlDependencies, getPlsqlImpact } from "@/lib/api";
import type {
  ImpactRelationship,
  PlsqlDependency,
  PlsqlDependencySummary,
  PlsqlImpactItem,
  PlsqlListOrder,
} from "@/lib/contracts";
import { problemCodeOf } from "./analysis-error";
import { ANALYSIS_PAGE_SIZE } from "./analysis-pagination";
import { usePagedQuery } from "./use-paged-query";
import {
  eagerDependencyCategories,
  type OverviewMetricDef,
} from "./overview-metrics";

/** Totals behind the dependency-sourced cards, keyed by metric. */
export type OverviewCardTotals = {
  counts: PlsqlDependencySummary["counts"];
  /** Metrics narrowed to one relationship count only that relationship. */
  narrowed: Partial<Record<OverviewMetricDef["key"], number>>;
};

function narrowedMetrics(metrics: OverviewMetricDef[]) {
  return metrics.flatMap((metric) =>
    metric.source.kind === "dependency" && metric.source.onlyRelationship
      ? [{ key: metric.key, source: metric.source }]
      : [],
  );
}

async function loadCardTotals(
  objectId: string,
  metrics: OverviewMetricDef[],
): Promise<OverviewCardTotals> {
  const [base] = eagerDependencyCategories(metrics);
  const [baseline, ...narrowed] = await Promise.all([
    getPlsqlDependencies(objectId, base ?? "callers", { limit: 1 }),
    ...narrowedMetrics(metrics).map(({ source }) =>
      getPlsqlDependencies(objectId, source.category, {
        limit: 1,
        relationship:
          source.onlyRelationship as PlsqlDependency["relationship"],
      }),
    ),
  ]);
  return {
    counts: baseline.counts,
    narrowed: Object.fromEntries(
      narrowedMetrics(metrics).map(({ key }, index) => [
        key,
        narrowed[index].total,
      ]),
    ),
  };
}

/**
 * Numbers for the dependency cards. One request returns every category's
 * count; a card narrowed to one relationship asks for its own total because
 * its category mixes other relationships.
 */
export function useOverviewCardTotals(
  objectId: string,
  metrics: OverviewMetricDef[],
  attempt: number,
) {
  const { data, error, isLoading } = useSWR(
    {
      resource: "plsql-overview-totals",
      objectId,
      keys: metrics.map((metric) => metric.key),
      attempt,
    },
    () => loadCardTotals(objectId, metrics),
  );
  return {
    totals: data,
    loading: isLoading,
    errorCode: error ? (problemCodeOf(error) ?? "unknown") : undefined,
  };
}

/** One page of the rows behind the selected card. */
export type OverviewRowsPage =
  | { kind: "impact"; items: PlsqlImpactItem[]; total: number }
  | { kind: "dependency"; edges: PlsqlDependency[]; total: number };

export type OverviewRowsQuery = {
  objectId: string;
  metric: OverviewMetricDef;
  /** 0-based. */
  page: number;
  depth: number;
  impactRelationship?: ImpactRelationship;
  /** `package` when the view groups by package, so pages run through packages alphabetically. */
  order: PlsqlListOrder;
};

async function loadRowsPage({
  objectId,
  metric,
  page,
  depth,
  impactRelationship,
  order,
}: OverviewRowsQuery): Promise<OverviewRowsPage> {
  const offset = page * ANALYSIS_PAGE_SIZE;
  if (metric.source.kind === "impact") {
    const result = await getPlsqlImpact(objectId, {
      limit: ANALYSIS_PAGE_SIZE,
      offset,
      direction: "upstream",
      depth,
      relationship: impactRelationship,
      scope: metric.source.scope,
      order,
    });
    if (!result) throw new Error("Object not found");
    return { kind: "impact", items: result.items, total: result.count };
  }
  const result = await getPlsqlDependencies(objectId, metric.source.category, {
    limit: ANALYSIS_PAGE_SIZE,
    offset,
    relationship: metric.source.onlyRelationship as
      PlsqlDependency["relationship"] | undefined,
    order,
  });
  return { kind: "dependency", edges: result.items, total: result.total };
}

/** The selected card's rows, one server-side page at a time. */
export function useOverviewRows(query: OverviewRowsQuery) {
  const { objectId, metric, depth, impactRelationship, order } = query;
  return usePagedQuery({
    listKey: `overview|${objectId}|${metric.key}|${depth}|${impactRelationship ?? ""}|${order}`,
    page: query.page,
    fetchPage: (page) => loadRowsPage({ ...query, page }),
  });
}
