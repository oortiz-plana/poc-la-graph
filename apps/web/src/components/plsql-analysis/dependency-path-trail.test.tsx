import { describe, expect, it } from "vitest";
import type { PlsqlDependency } from "@/lib/contracts";
import { dependencyToPath } from "./dependency-path-trail";

const edge: PlsqlDependency = {
  id: "edge://sample/WRITES/1",
  relationship: "WRITES",
  resolution: "EXACT",
  source: {
    id: "plsql://sample/HR/PROCEDURE/RUN_PAYROLL",
    kind: "Procedure",
    name: "RUN_PAYROLL",
    schema: "HR",
    qualifiedName: "HR.PKG_PAYROLL.RUN_PAYROLL",
  },
  target: {
    id: "plsql://sample/HR/TABLE/EMPLOYEES",
    kind: "Table",
    name: "EMPLOYEES",
    schema: "HR",
    qualifiedName: "HR.EMPLOYEES",
  },
  evidence: null,
};

describe("dependencyToPath", () => {
  it("renders a single edge as a one-hop path", () => {
    const path = dependencyToPath(edge);
    expect(path.nodes).toEqual([edge.source, edge.target]);
    expect(path.relationships).toEqual([edge]);
  });
});
