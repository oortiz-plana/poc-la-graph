import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("renders the object name as plain text without onOpenObject", () => {
    render(<InspectorPanel inspection={{ kind: "object", object }} />);
    expect(
      screen.queryByRole("button", { name: "DOCU_FIDE" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("DOCU_FIDE")).toBeInTheDocument();
  });

  it("jumps to the object's overview when its name is clicked", async () => {
    const onOpenObject = vi.fn();
    render(
      <InspectorPanel
        inspection={{ kind: "object", object }}
        onOpenObject={onOpenObject}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "DOCU_FIDE" }));
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: object.id, name: "DOCU_FIDE" }),
    );
  });

  it("shows edge details with confidence", () => {
    render(<InspectorPanel inspection={{ kind: "edge", edge }} />);
    expect(screen.getByText("Dependency edge")).toBeInTheDocument();
    expect(screen.getByText("Inferred")).toBeInTheDocument();
    expect(screen.getByText("CALLS")).toBeInTheDocument();
    expect(screen.getByText("hr/fa_qfact_calc.pkb:429")).toBeInTheDocument();
  });

  it("jumps to an edge endpoint's overview when clicked", async () => {
    const onOpenObject = vi.fn();
    render(
      <InspectorPanel
        inspection={{ kind: "edge", edge }}
        onOpenObject={onOpenObject}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "HR.FA_QFACT_CALC.CALC_IVA_MORA" }),
    );
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
  });

  it("shows path endpoints and hops", () => {
    render(<InspectorPanel inspection={{ kind: "path", path }} />);
    expect(screen.getByText("Dependency path")).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();
  });

  it("jumps to a path node's overview when clicked", async () => {
    const onOpenObject = vi.fn();
    render(
      <InspectorPanel
        inspection={{ kind: "path", path }}
        onOpenObject={onOpenObject}
      />,
    );
    // The node appears twice (the From/To summary and the full path list);
    // either link must navigate to the same object.
    const links = screen.getAllByRole("button", {
      name: "HR.FA_QFACT_CALC.DOCU_FIDE",
    });
    expect(links).toHaveLength(2);
    await userEvent.click(links[0]);
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "DOCU_FIDE" }),
    );
  });
});
