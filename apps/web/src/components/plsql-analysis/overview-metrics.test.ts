import { describe, expect, it } from "vitest";
import {
  eagerDependencyCategories,
  overviewMetricsForKind,
} from "./overview-metrics";

describe("overviewMetricsForKind", () => {
  it("shows dependent/reader/writer/trigger metrics for a Table", () => {
    const config = overviewMetricsForKind("Table");
    expect(config.metrics.map((metric) => metric.key)).toEqual([
      "directDependents",
      "indirectDependents",
      "readers",
      "writers",
      "triggers",
    ]);
    expect(config.impactRelationship).toBeUndefined();
  });

  it("shows the same metric set for a View as for a Table", () => {
    expect(overviewMetricsForKind("View")).toEqual(
      overviewMetricsForKind("Table"),
    );
  });

  it("shows caller/callee/table-access metrics for a Function, filtered to CALLS", () => {
    const config = overviewMetricsForKind("Function");
    expect(config.metrics.map((metric) => metric.key)).toEqual([
      "directCallers",
      "indirectCallers",
      "callees",
      "tablesRead",
      "tablesModified",
    ]);
    expect(config.impactRelationship).toBe("CALLS");
  });

  it("shows the same metric set for a Procedure as for a Function", () => {
    expect(overviewMetricsForKind("Procedure")).toEqual(
      overviewMetricsForKind("Function"),
    );
  });

  it("shows trigger-specific metrics for a Trigger", () => {
    const config = overviewMetricsForKind("Trigger");
    expect(config.metrics.map((metric) => metric.key)).toEqual([
      "triggeredTable",
      "calls",
      "tablesRead",
      "tablesModified",
      "indirectDependents",
    ]);
  });

  it("falls back to the Table metric set for kinds without a dedicated config", () => {
    expect(overviewMetricsForKind("Sequence")).toEqual(
      overviewMetricsForKind("Table"),
    );
  });

  it("never shows metrics that are not meaningful for the kind (e.g. no Callers card on a Table)", () => {
    const config = overviewMetricsForKind("Table");
    expect(config.metrics.some((metric) => metric.key === "callers")).toBe(
      false,
    );
  });
});

describe("eagerDependencyCategories", () => {
  it("starts with the first dependency-sourced metric's category", () => {
    expect(
      eagerDependencyCategories(overviewMetricsForKind("Function").metrics),
    ).toEqual(["callees"]);
    expect(
      eagerDependencyCategories(overviewMetricsForKind("Trigger").metrics),
    ).toEqual(["other"]);
  });

  it("also loads the category of a relationship-narrowed metric, so its card is exact", () => {
    // Tables and views count only TRIGGER_ON edges out of the mixed "other"
    // category (which also holds foreign keys and view dependencies).
    expect(
      eagerDependencyCategories(overviewMetricsForKind("Table").metrics),
    ).toEqual(["reads", "other"]);
    expect(
      eagerDependencyCategories(overviewMetricsForKind("View").metrics),
    ).toEqual(["reads", "other"]);
  });

  it("returns nothing when no metric is dependency-sourced", () => {
    expect(eagerDependencyCategories([])).toEqual([]);
  });
});
