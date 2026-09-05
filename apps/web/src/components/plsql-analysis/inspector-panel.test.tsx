import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlsqlDependency, PlsqlObject, PlsqlPath } from "@/lib/contracts";
import { InspectorPanel } from "./inspector-panel";

const object: PlsqlObject = {
  id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
  kind: "Function",
  name: "DOCU_FIDE",
  schema: "HR",
  qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
  projectId: "sample",
  owner: "FA_QFACT_CALC",
  signature: null,
  returnType: null,
  declaration: {
    sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
    path: "hr/fa_qfact_calc.pkb",
    startLine: 428,
    startColumn: 3,
    startOffset: 512,
    endOffset: 600,
  },
};

const edge: PlsqlDependency = {
  id: "edge://sample/CALLS/1",
  relationship: "CALLS",
  resolution: "INFERRED",
  source: {
    id: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
    kind: "Function",
    name: "CALC_IVA_MORA",
    schema: "HR",
    qualifiedName: "HR.FA_QFACT_CALC.CALC_IVA_MORA",
  },
  target: {
    id: object.id,
    kind: "Function",
    name: "DOCU_FIDE",
    schema: "HR",
    qualifiedName: object.qualifiedName,
  },
  evidence: {
    sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
    path: "hr/fa_qfact_calc.pkb",
    startLine: 429,
    startColumn: 1,
    startOffset: 1,
    endOffset: 2,
  },
};

const path: PlsqlPath = {
  id: "path://sample/p1",
  nodes: [edge.source, edge.target],
  relationships: [edge],
  hopCount: 1,
};

describe("InspectorPanel", () => {
  it("shows a hint without a selection", () => {
    render(<InspectorPanel />);
    expect(
      screen.getByText(/Select an object, dependency, or path/),
    ).toBeInTheDocument();
  });

  it("shows object metadata", () => {
    render(<InspectorPanel inspection={{ kind: "object", object }} />);
    expect(screen.getByText("Object details")).toBeInTheDocument();
    expect(screen.getByText("HR.FA_QFACT_CALC.DOCU_FIDE")).toBeInTheDocument();
    expect(screen.getByText("FA_QFACT_CALC")).toBeInTheDocument();
    expect(screen.getByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(screen.getByText("428")).toBeInTheDocument();
  });

  it("shows edge details with confidence", () => {
    render(<InspectorPanel inspection={{ kind: "edge", edge }} />);
    expect(screen.getByText("Dependency edge")).toBeInTheDocument();
    expect(screen.getByText("Inferred")).toBeInTheDocument();
    expect(screen.getByText("CALLS")).toBeInTheDocument();
    expect(screen.getByText("hr/fa_qfact_calc.pkb:429")).toBeInTheDocument();
  });

  it("shows path endpoints and hops", () => {
    render(<InspectorPanel inspection={{ kind: "path", path }} />);
    expect(screen.getByText("Dependency path")).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();
  });
});
