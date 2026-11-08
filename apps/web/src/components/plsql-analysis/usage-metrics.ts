import type { PlsqlUsageWindow } from "@/lib/contracts";

/** Windows the usage endpoint accepts, shortest first. */
export const USAGE_WINDOWS: readonly PlsqlUsageWindow[] = [7, 30, 90];

/**
 * Console operations by their API route name. Each value names the
 * `plsqlUsage.operations.<key>` message holding its readable label.
 */
const OPERATION_LABEL_KEYS = {
  search_objects: "searchObjects",
  get_object: "getObject",
  get_overview: "getOverview",
  get_dependencies: "getDependencies",
  list_callers: "listCallers",
  list_callees: "listCallees",
  list_table_access: "listTableAccess",
  find_paths: "findPaths",
  list_unresolved: "listUnresolved",
  get_health: "getHealth",
  get_relationship_evidence: "getRelationshipEvidence",
  get_object_source: "getObjectSource",
  get_file_source: "getFileSource",
  get_impact_summary: "getImpactSummary",
  get_impact: "getImpact",
} as const;

export type UsageOperationLabelKey =
  (typeof OPERATION_LABEL_KEYS)[keyof typeof OPERATION_LABEL_KEYS];

/** The message key for an operation, or `undefined` for one this UI does not know yet. */
export function operationLabelKey(
  operation: string,
): UsageOperationLabelKey | undefined {
  return Object.hasOwn(OPERATION_LABEL_KEYS, operation)
    ? OPERATION_LABEL_KEYS[operation as keyof typeof OPERATION_LABEL_KEYS]
    : undefined;
}

/** Share of failed requests as a 0–1 fraction; `undefined` when nothing ran. */
export function errorRate(
  requests: number,
  errors: number,
): number | undefined {
  return requests > 0 ? errors / requests : undefined;
}

/** Width of one day's bar as a percentage of the busiest day. */
export function barPercent(requests: number, busiest: number): number {
  return busiest > 0 ? Math.round((requests / busiest) * 100) : 0;
}
