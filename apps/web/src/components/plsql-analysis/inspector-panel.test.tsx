import { screen, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
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
    // The declaration is a file plus a readable line, not raw offsets.
    expect(screen.getByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(screen.getByText("line 428")).toBeInTheDocument();
    expect(screen.queryByText(/offset/i)).not.toBeInTheDocument();
  });

  it("opens or analyzes the object it is showing, not another one", async () => {
    const onOpenObject = vi.fn();
    const onAnalyzeObject = vi.fn();
    render(
      <InspectorPanel
        inspection={{ kind: "object", object }}
        onOpenObject={onOpenObject}
        onAnalyzeObject={onAnalyzeObject}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open object" }));
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: object.id }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Analyze impact for DOCU_FIDE" }),
    );
    expect(onAnalyzeObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: object.id }),
    );
  });

  it("offers no actions without handlers", () => {
    render(<InspectorPanel inspection={{ kind: "object", object }} />);
    expect(screen.queryByRole("button", { name: "Open object" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Analyze impact/ })).toBeNull();
  });

  it("copies the qualified name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<InspectorPanel inspection={{ kind: "object", object }} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Copy qualified name" }),
    );
    expect(writeText).toHaveBeenCalledWith("HR.FA_QFACT_CALC.DOCU_FIDE");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
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

  it("shows a dependency as a one-hop timeline with confidence and evidence", () => {
    render(<InspectorPanel inspection={{ kind: "edge", edge }} />);
    expect(screen.getByText("Dependency")).toBeInTheDocument();
    expect(screen.getByText("Inferred")).toBeInTheDocument();
    const flow = within(screen.getByRole("list", { name: "Dependency" }));
    expect(flow.getByText("calls")).toBeInTheDocument();
    expect(flow.getByText("CALLS")).toBeInTheDocument();
    expect(flow.getByText("From")).toBeInTheDocument();
    expect(flow.getByText("To")).toBeInTheDocument();
    // Evidence: the file and the line are separate, easy to scan.
    expect(screen.getByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(screen.getByText("line 429")).toBeInTheDocument();
  });

  it("lists every call site of a dependency referenced on several lines", () => {
    const at = (startLine: number) => ({
      sourceFileId: "file://sample/hr/a.pkb",
      path: "hr/a.pkb",
      startLine,
      startColumn: 1,
      startOffset: startLine,
      endOffset: startLine + 1,
    });
    render(
      <InspectorPanel
        inspection={{
          kind: "edge",
          edge: {
            ...edge,
            evidence: at(3774),
            occurrences: [at(3774), at(3792), at(3812)],
            occurrenceCount: 3,
          },
        }}
      />,
    );
    expect(screen.getByText("3 occurrences")).toBeInTheDocument();
    for (const line of [3774, 3792, 3812]) {
      expect(screen.getByText(`line ${line}`)).toBeInTheDocument();
    }
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

  it("shows the path as a timeline with endpoints, hops and the relationship as a sentence", () => {
    render(<InspectorPanel inspection={{ kind: "path", path }} />);
    expect(screen.getByText("Dependency path")).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();

    const stops = within(screen.getByRole("list", { name: "Full path" }));
    expect(stops.getAllByRole("listitem")).toHaveLength(2);
    // Each end is tagged; the name is large and the schema/package is context.
    expect(stops.getByText("From")).toBeInTheDocument();
    expect(stops.getByText("To")).toBeInTheDocument();
    expect(stops.getByText("CALC_IVA_MORA")).toBeInTheDocument();
    // Both ends live in the same package, so the context line shows twice.
    expect(stops.getAllByText("HR.FA_QFACT_CALC")).toHaveLength(2);
    // The hop reads as a sentence ("calls") next to the technical chip.
    expect(stops.getByText("calls")).toBeInTheDocument();
    expect(stops.getByText("CALLS")).toBeInTheDocument();
  });

  it("jumps to a path node's overview when its card is clicked", async () => {
    const onOpenObject = vi.fn();
    render(
      <InspectorPanel
        inspection={{ kind: "path", path }}
        onOpenObject={onOpenObject}
      />,
    );
    const links = screen.getAllByRole("button", {
      name: "HR.FA_QFACT_CALC.DOCU_FIDE",
    });
    expect(links).toHaveLength(1);
    await userEvent.click(links[0]);
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "DOCU_FIDE" }),
    );
  });

  it("numbers every stop of a longer path and writes each hop out", () => {
    const node = (name: string, kind: "Procedure" | "Table") => ({
      id: `plsql://sample/HR/${name}`,
      kind,
      name,
      schema: "HR",
      qualifiedName: `HR.PKG.${name}`,
    });
    const [a, b, c] = [
      node("A", "Procedure"),
      node("B", "Procedure"),
      node("T", "Table"),
    ];
    const hop = (
      source: typeof a,
      target: typeof a,
      relationship: PlsqlDependency["relationship"],
    ): PlsqlDependency => ({
      id: `edge://${source.name}/${relationship}/${target.name}`,
      relationship,
      resolution: "EXACT",
      source,
      target,
      evidence: null,
    });
    const long: PlsqlPath = {
      id: "path://long",
      nodes: [a, b, c],
      relationships: [hop(a, b, "CALLS"), hop(b, c, "WRITES")],
      hopCount: 2,
    };
    render(<InspectorPanel inspection={{ kind: "path", path: long }} />);
    const stops = within(screen.getByRole("list", { name: "Full path" }));
    expect(screen.getByText("2 hops")).toBeInTheDocument();
    expect(stops.getAllByRole("listitem")).toHaveLength(3);
    expect(stops.getByLabelText("Step 2")).toBeInTheDocument();
    expect(stops.getByText("calls")).toBeInTheDocument();
    expect(stops.getByText("writes to")).toBeInTheDocument();
    // Only the two ends carry a From / To tag.
    expect(stops.getAllByText(/^(From|To)$/)).toHaveLength(2);
  });
});
