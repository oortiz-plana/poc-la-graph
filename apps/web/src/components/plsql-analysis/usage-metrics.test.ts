import { describe, expect, it } from "vitest";
import en from "../../../messages/en";
import {
  USAGE_WINDOWS,
  barPercent,
  errorRate,
  operationLabelKey,
} from "./usage-metrics";

describe("usage metrics", () => {
  it("offers the windows the API accepts", () => {
    expect(USAGE_WINDOWS).toEqual([7, 30, 90]);
  });

  it("maps known operations to a label that exists in the catalog", () => {
    const key = operationLabelKey("get_impact");
    expect(key).toBe("getImpact");
    expect(en.plsqlUsage.operations[key!]).toBe("Impact report");
  });

  it("leaves unknown or inherited operation names unlabelled", () => {
    expect(operationLabelKey("new_operation")).toBeUndefined();
    expect(operationLabelKey("toString")).toBeUndefined();
  });

  it("computes the error rate only when something ran", () => {
    expect(errorRate(0, 0)).toBeUndefined();
    expect(errorRate(8, 2)).toBe(0.25);
  });

  it("scales bars against the busiest day", () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(0, 0)).toBe(0);
  });
});
