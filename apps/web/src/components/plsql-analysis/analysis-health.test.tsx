import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlsqlHealth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlHealth }));

import { AnalysisHealth } from "./analysis-health";

function health(total: number) {
  const empty = { count: 0, items: [] };
  return {
    total,
    unresolved: empty,
    ambiguous: empty,
    dynamicSql: empty,
    parseErrors: empty,
    unsupported: empty,
    truncated: false,
  };
}

describe("AnalysisHealth trigger", () => {
  beforeEach(() => {
    getPlsqlHealth.mockReset();
  });

  it("counts diagnostics for the selected object, matching the dialog's scope", async () => {
    getPlsqlHealth.mockResolvedValue(health(3));
    render(
      <AnalysisHealth objectId="plsql://p/HR/X" onOpenEvidence={vi.fn()} />,
    );
    expect(
      await screen.findByRole("button", {
        name: "Analysis Health, 3 diagnostics for this object",
      }),
    ).toBeInTheDocument();
    expect(getPlsqlHealth).toHaveBeenCalledWith("plsql://p/HR/X");
  });

  it("counts repository-wide diagnostics when no object is selected", async () => {
    getPlsqlHealth.mockResolvedValue(health(1));
    render(<AnalysisHealth onOpenEvidence={vi.fn()} />);
    expect(
      await screen.findByRole("button", {
        name: "Analysis Health, 1 diagnostic for the repository",
      }),
    ).toBeInTheDocument();
  });

  it("refreshes the count when another object is selected", async () => {
    getPlsqlHealth.mockImplementation(async (objectId?: string) =>
      health(objectId === "b" ? 0 : 2),
    );
    const { rerender } = render(
      <AnalysisHealth objectId="a" onOpenEvidence={vi.fn()} />,
    );
    await screen.findByRole("button", { name: /2 diagnostics/ });
    rerender(<AnalysisHealth objectId="b" onOpenEvidence={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Analysis Health" }),
      ).toBeInTheDocument(),
    );
  });
});
