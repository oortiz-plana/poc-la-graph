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

export type OverviewMetricDef = {
  key: string;
  label: string;
  source: OverviewMetricSource;
  columns: OverviewMetricColumns;
  /** Header for the subject column, e.g. "Trigger" instead of "Object". */
  subjectColumnHeader: string;
  emptyMessage: string;
};

export type OverviewMetricsConfig = {
  /** Impact-endpoint relationship filter shared by every impact-sourced metric of this kind. */
  impactRelationship?: ImpactRelationship;
  metrics: OverviewMetricDef[];
};

const TABLE_METRICS: OverviewMetricDef[] = [
  {
    key: "directDependents",
    label: "Direct dependents",
    source: { kind: "impact", scope: "direct" },
    columns: "relationship",
    subjectColumnHeader: "Object",
    emptyMessage: "No direct dependents",
  },
  {
    key: "indirectDependents",
    label: "Indirect dependents",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "Object",
    emptyMessage: "No indirect dependents",
  },
  {
    key: "readers",
    label: "Readers",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No readers",
  },
  {
    key: "writers",
    label: "Writers",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No writers",
  },
  {
    key: "triggers",
    label: "Triggers",
    source: {
      kind: "dependency",
      category: "other",
      onlyRelationship: "TRIGGER_ON",
    },
    columns: "relationship",
    subjectColumnHeader: "Trigger",
    emptyMessage: "No triggers",
  },
];

const ROUTINE_METRICS: OverviewMetricDef[] = [
  {
    key: "directCallers",
    label: "Direct callers",
    source: { kind: "impact", scope: "direct" },
    columns: "relationship",
    subjectColumnHeader: "Object",
    emptyMessage: "No direct callers",
  },
  {
    key: "indirectCallers",
    label: "Indirect callers",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "Object",
    emptyMessage: "No indirect callers",
  },
  {
    key: "callees",
    label: "Callees",
    source: { kind: "dependency", category: "callees" },
    columns: "relationship",
    subjectColumnHeader: "Object",
    emptyMessage: "No callees",
  },
  {
    key: "tablesRead",
    label: "Tables read",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No tables read",
  },
  {
    key: "tablesModified",
    label: "Tables modified",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No tables modified",
  },
];

const TRIGGER_METRICS: OverviewMetricDef[] = [
  {
    key: "triggeredTable",
    label: "Triggered table",
    source: {
      kind: "dependency",
      category: "other",
      onlyRelationship: "TRIGGER_ON",
    },
    columns: "relationship",
    subjectColumnHeader: "Table",
    emptyMessage: "No triggered table found",
  },
  {
    key: "calls",
    label: "Calls",
    source: { kind: "dependency", category: "callees" },
    columns: "relationship",
    subjectColumnHeader: "Object",
    emptyMessage: "No calls",
  },
  {
    key: "tablesRead",
    label: "Tables read",
    source: { kind: "dependency", category: "reads" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No tables read",
  },
  {
    key: "tablesModified",
    label: "Tables modified",
    source: { kind: "dependency", category: "writes" },
    columns: "operation",
    subjectColumnHeader: "Object",
    emptyMessage: "No tables modified",
  },
  {
    key: "indirectDependents",
    label: "Indirect dependents",
    source: { kind: "impact", scope: "indirect" },
    columns: "distance",
    subjectColumnHeader: "Object",
    emptyMessage: "No indirect dependents",
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
 * The first dependency-category metric's category, if any. A single fetch
 * of any one category returns every category's counts, so this is the one
 * category worth fetching eagerly to populate every dependency-sourced card.
 */
export function firstDependencyCategory(
  metrics: OverviewMetricDef[],
): PlsqlDependencyCategory | undefined {
  for (const metric of metrics) {
    if (metric.source.kind === "dependency") return metric.source.category;
  }
  return undefined;
}
