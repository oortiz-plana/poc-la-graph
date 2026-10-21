import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl as render } from "@/test/render-with-intl";
import type { PlsqlDependency } from "@/lib/contracts";
import { dependencyToPath, DependencyPathTrail } from "./dependency-path-trail";
import { InspectedObjectProvider } from "./inspected-object";

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

describe("DependencyPathTrail", () => {
  it("marks the stop the Inspector is showing, and only that one", () => {
    render(
      <InspectedObjectProvider value={edge.target.id}>
        <DependencyPathTrail
          path={dependencyToPath(edge)}
          onOpenObject={vi.fn()}
        />
      </InspectedObjectProvider>,
    );
    const stops = within(screen.getByRole("list", { name: "Full path" }));
    expect(stops.getAllByText("In details")).toHaveLength(1);
    const shown = stops.getByRole("button", { name: "HR.EMPLOYEES" });
    expect(shown).toHaveAttribute("aria-current", "true");
    expect(shown).toHaveTextContent("In details");
    const other = stops.getByRole("button", {
      name: "HR.PKG_PAYROLL.RUN_PAYROLL",
    });
    expect(other).not.toHaveAttribute("aria-current");
    expect(other).not.toHaveTextContent("In details");
  });

  it("marks nothing when the Inspector shows no object of the path", () => {
    render(
      <InspectedObjectProvider value="plsql://sample/HR/TABLE/OTHER">
        <DependencyPathTrail path={dependencyToPath(edge)} />
      </InspectedObjectProvider>,
    );
    expect(screen.queryByText("In details")).toBeNull();
  });
});
