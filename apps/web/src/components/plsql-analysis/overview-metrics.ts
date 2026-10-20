import type {
  ImpactRelationship,
  PlsqlDependencyCategory,
  PlsqlObjectKind,
} from "@/lib/contracts";

/** Where one metric's number and detail rows come from. */
export type OverviewMetricSource =
  | { kind: "impact"; scope: "direct" | "indirect" }
  | {
      kind: "dependency";
      category: PlsqlDependencyCategory;
      /** Narrow a mixed category (e.g. "other") to one relationship. */
      onlyRelationship?: string;
    };

/** Which detail-table column set a metric uses; see `dependency-detail-table.tsx`. */
export type OverviewMetricColumns = "relationship" | "distance" | "operation";

/**
 * Metric identifiers. Each one names the `plsqlOverview.metrics.<key>` message
 * group holding its card label and empty-state text.
 */
export type OverviewMetricKey =
  | "directDependents"
  | "indirectDependents"
  | "readers"
  | "writers"
  | "triggers"
  | "directCallers"
  | "indirectCallers"
  | "callees"
  | "tablesRead"
  | "tablesModified"
  | "triggeredTable"
  | "calls";

export type OverviewMetricDef = {
  key: OverviewMetricKey;
  source: OverviewMetricSource;
  columns: OverviewMetricColumns;
  /** Header for the subject column, e.g. "trigger" instead of "object"; a `plsqlOverview.metrics.subject` key. */
  subjectColumnHeader: "object" | "trigger" | "table";
};

export type OverviewMetricsConfig = {
  /** Impact-endpoint relationship filter shared by every impact-sourced metric of this kind. */
  impactRelationship?: ImpactRelationship;
  metrics: OverviewMetricDef[];
};

const TABLE_METRICS: OverviewMetricDef[] = [
  {
    key: "directDependents",
    source: { kind: "impact", scope: "direct" },
    columns: "relationship",
    subjectColumnHeader: "object",
  },
  {
    key: "indirectDependents",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "object",
  },
  {
    key: "readers",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
  {
    key: "writers",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
  {
    key: "triggers",
    source: {
      kind: "dependency",
      category: "other",
      onlyRelationship: "TRIGGER_ON",
    },
    columns: "relationship",
    subjectColumnHeader: "trigger",
  },
];

const ROUTINE_METRICS: OverviewMetricDef[] = [
  {
    key: "directCallers",
    source: { kind: "impact", scope: "direct" },
    columns: "relationship",
    subjectColumnHeader: "object",
  },
  {
    key: "indirectCallers",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "object",
  },
  {
    key: "callees",
    source: { kind: "dependency", category: "callees" },
    columns: "relationship",
    subjectColumnHeader: "object",
  },
  {
    key: "tablesRead",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
  {
    key: "tablesModified",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
];

const TRIGGER_METRICS: OverviewMetricDef[] = [
  {
    key: "triggeredTable",
    source: {
      kind: "dependency",
      category: "other",
      onlyRelationship: "TRIGGER_ON",
    },
    columns: "relationship",
    subjectColumnHeader: "table",
  },
  {
    key: "calls",
    source: { kind: "dependency", category: "callees" },
    columns: "relationship",
    subjectColumnHeader: "object",
  },
  {
    key: "tablesRead",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
  {
    key: "tablesModified",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "object",
  },
  {
    key: "indirectDependents",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "object",
  },
];

const CONFIG_BY_KIND: Partial<Record<PlsqlObjectKind, OverviewMetricsConfig>> =
  {
    Table: { metrics: TABLE_METRICS },
    View: { metrics: TABLE_METRICS },
    Procedure: { metrics: ROUTINE_METRICS, impactRelationship: "CALLS" },
    Function: { metrics: ROUTINE_METRICS, impactRelationship: "CALLS" },
    AnonymousBlock: {
      metrics: ROUTINE_METRICS,
      impactRelationship: "CALLS",
    },
    Trigger: { metrics: TRIGGER_METRICS },
  };

/**
 * Single source of truth for which Overview metrics apply to an object kind.
 * Kinds without a dedicated set (Package, Sequence, Index, Synonym, Type)
 * fall back to the Table set: "what depends on this" is always meaningful,
 * even when readers/writers/triggers happen to be empty for that object.
 */
export function overviewMetricsForKind(
  kind: PlsqlObjectKind,
): OverviewMetricsConfig {
  return CONFIG_BY_KIND[kind] ?? { metrics: TABLE_METRICS };
}

/**
 * Dependency categories to fetch up front. One fetch of any category returns
 * every category's counts, so the first dependency-sourced metric's category
 * populates the plain cards. A metric narrowed to one relationship
 * (`onlyRelationship`) cannot use those counts, because its category mixes
 * other relationships (e.g. "other" holds triggers, foreign keys and view
 * dependencies), so its category is fetched too and the card is right on the
 * first render instead of changing once the card is opened.
 */
export function eagerDependencyCategories(
  metrics: OverviewMetricDef[],
): PlsqlDependencyCategory[] {
  const categories: PlsqlDependencyCategory[] = [];
  const add = (category: PlsqlDependencyCategory) => {
    if (!categories.includes(category)) categories.push(category);
  };
  for (const metric of metrics) {
    if (metric.source.kind !== "dependency") continue;
    if (categories.length === 0 || metric.source.onlyRelationship) {
      add(metric.source.category);
    }
  }
  return categories;
}
