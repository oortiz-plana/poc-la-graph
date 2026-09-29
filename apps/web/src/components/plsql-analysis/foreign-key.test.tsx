import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  impactRelationshipSchema,
  plsqlDependencySchema,
  plsqlImpactResultSchema,
  plsqlPathSchema,
} from "@/lib/contracts";
import { DependencyPathTrail, dependencyToPath } from "./dependency-path-trail";
import { InspectorPanel } from "./inspector-panel";

const table = (name: string) => ({
  id: name,
  name,
  kind: "Table",
  schema: "HR",
  qualifiedName: `HR.${name}`,
});
const raw = {
  id: "foreign-key",
  relationship: "FOREIGN_KEY",
  resolution: "EXACT",
  source: table("EMPLOYEES"),
  target: table("DEPARTMENTS"),
  evidence: {
    sourceFileId: "employee-file",
    path: "hr/employees.sql",
    startLine: 5,
  },
};

describe("foreign-key browser contract and evidence", () => {
  it("validates dependencies, paths, impact, and the filter without accepting unknown relationships", () => {
    const edge = plsqlDependencySchema.parse(raw);
    const path = plsqlPathSchema.parse({
      ...dependencyToPath(edge),
      id: "path",
      hopCount: 1,
    });
    expect(path.nodes.map((node) => node.name)).toEqual([
      "EMPLOYEES",
      "DEPARTMENTS",
    ]);
    expect(impactRelationshipSchema.parse("FOREIGN_KEY")).toBe("FOREIGN_KEY");
    expect(
      plsqlImpactResultSchema.safeParse({
        object: { ...raw.target, projectId: "sample" },
        items: [
          { id: "impact", dependent: raw.source, distance: 1, paths: [path] },
        ],
        summary: { direct: 1, indirect: 0, packages: 0, tablesModified: 0 },
        count: 1,
        truncated: false,
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      plsqlDependencySchema.safeParse({ ...raw, relationship: "UNKNOWN" })
        .success,
    ).toBe(false);
  });

  it("opens the stored foreign-key edge and evidence from the path using the keyboard", async () => {
    const edge = plsqlDependencySchema.parse(raw);
    const onInspectEdge = vi.fn();
    const onOpenEvidence = vi.fn();
    render(
      <DependencyPathTrail
        path={dependencyToPath(edge)}
        onInspectEdge={onInspectEdge}
        onOpenEvidence={onOpenEvidence}
      />,
    );
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "FOREIGN_KEY" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onInspectEdge).toHaveBeenCalledWith(edge);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onOpenEvidence).toHaveBeenCalledWith(edge.evidence);
  });

  it.each([true, false])(
    "preserves inspector evidence availability: %s",
    (available) => {
      const edge = plsqlDependencySchema.parse({
        ...raw,
        evidence: available ? raw.evidence : null,
      });
      render(<InspectorPanel inspection={{ kind: "edge", edge }} />);
      expect(screen.getByText("FOREIGN_KEY")).toBeInTheDocument();
      if (available) {
        expect(screen.getByText("hr/employees.sql:5")).toBeInTheDocument();
      } else {
        expect(screen.getByText("None")).toBeInTheDocument();
      }
    },
  );
});
