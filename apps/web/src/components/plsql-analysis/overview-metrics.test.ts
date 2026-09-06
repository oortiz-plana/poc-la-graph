import { describe, expect, it } from "vitest";
import {
  firstDependencyCategory,
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

describe("firstDependencyCategory", () => {
  it("finds the first dependency-sourced metric's category", () => {
    expect(
      firstDependencyCategory(overviewMetricsForKind("Table").metrics),
    ).toBe("reads");
    expect(
      firstDependencyCategory(overviewMetricsForKind("Function").metrics),
    ).toBe("callees");
    expect(
      firstDependencyCategory(overviewMetricsForKind("Trigger").metrics),
    ).toBe("other");
  });

  it("returns undefined when no metric is dependency-sourced", () => {
    expect(firstDependencyCategory([])).toBeUndefined();
  });
});
