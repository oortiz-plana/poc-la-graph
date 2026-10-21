import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlDependency, PlsqlHealth } from "@/lib/contracts";
import { HealthPanel } from "./health-panel";

const getPlsqlHealth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlHealth }));

const unresolvedEdge: PlsqlDependency = {
  id: "edge://sample/CALLS/UNRESOLVED",
  relationship: "CALLS",
  resolution: "UNRESOLVED",
  source: {
    id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
    kind: "Function",
    name: "DOCU_FIDE",
    schema: "HR",
    qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
  },
  target: {
    id: "plsql://sample/HR/PROCEDURE/MISSING",
    kind: "Procedure",
    name: "MISSING",
    schema: "HR",
    qualifiedName: "HR.MISSING",
  },
  evidence: {
    sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
    path: "hr/fa_qfact_calc.pkb",
    startLine: 40,
    startColumn: 1,
    startOffset: 1,
    endOffset: 2,
  },
};

const ambiguousEdge: PlsqlDependency = {
  ...unresolvedEdge,
  id: "edge://sample/READS/AMBIGUOUS",
  relationship: "READS",
  resolution: "AMBIGUOUS",
  target: {
    id: "plsql://sample/HR/VIEW/EMPLOYEE_DETAILS",
    kind: "View",
    name: "EMPLOYEE_DETAILS",
    schema: "HR",
    qualifiedName: "HR.EMPLOYEE_DETAILS",
  },
};

function healthFixture(): PlsqlHealth {
  return {
    total: 2,
    unresolved: { count: 1, items: [unresolvedEdge] },
    ambiguous: { count: 1, items: [ambiguousEdge] },
    dynamicSql: { count: 0, items: [] },
    parseErrors: { count: 0, items: [] },
    unsupported: { count: 0, items: [] },
    truncated: false,
  };
}

describe("HealthPanel", () => {
  afterEach(() => getPlsqlHealth.mockReset());

  it("renders category chips with counts and the default category list", async () => {
    getPlsqlHealth.mockResolvedValue(healthFixture());
    render(<HealthPanel onOpenEvidence={vi.fn()} />);
    expect(
      await screen.findByRole("button", { name: /Unresolved references/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ambiguous references")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText((content) => content.includes("HR.MISSING")),
      ).toBeInTheDocument(),
    );
  });

  it("switches categories and reports evidence clicks", async () => {
    const onOpenEvidence = vi.fn();
    getPlsqlHealth.mockResolvedValue(healthFixture());
    const user = userEvent.setup();
    render(<HealthPanel onOpenEvidence={onOpenEvidence} />);
    await user.click(
      await screen.findByRole("button", { name: /Ambiguous references/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByText((content) => content.includes("EMPLOYEE_DETAILS")),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "line 40" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ path: "hr/fa_qfact_calc.pkb" }),
    );
  });

  it("scopes the fetch to an object and offers the repository-wide toggle", async () => {
    getPlsqlHealth.mockResolvedValue(healthFixture());
    const user = userEvent.setup();
    render(
      <HealthPanel
        objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
        onOpenEvidence={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: /Unresolved references/ });
    const firstPage = { category: "unresolved", limit: 25, offset: 0 };
    expect(getPlsqlHealth).toHaveBeenCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      firstPage,
    );
    await user.click(screen.getByLabelText("Show repository-wide diagnostics"));
    await waitFor(() =>
      expect(getPlsqlHealth).toHaveBeenCalledWith(undefined, firstPage),
    );
  });

  it("shows the all-clear message when nothing is reported", async () => {
    getPlsqlHealth.mockResolvedValue({
      ...healthFixture(),
      total: 0,
      unresolved: { count: 0, items: [] },
      ambiguous: { count: 0, items: [] },
    });
    render(<HealthPanel onOpenEvidence={vi.fn()} />);
    expect(
      await screen.findByText(/No diagnostics reported/),
    ).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    getPlsqlHealth
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue(healthFixture());
    const user = userEvent.setup();
    render(<HealthPanel onOpenEvidence={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    expect(
      await screen.findByRole("button", { name: /Unresolved references/ }),
    ).toBeInTheDocument();
  });

  it("pages the open category and keeps every category's count", async () => {
    getPlsqlHealth.mockImplementation(
      async (
        _objectId: string | undefined,
        options: { category: string; offset: number },
      ) => ({
        ...healthFixture(),
        total: 60 + 1,
        unresolved: {
          count: 60,
          items:
            options.category === "unresolved"
              ? [
                  {
                    ...unresolvedEdge,
                    id: `edge://sample/CALLS/U${options.offset}`,
                    target: {
                      ...unresolvedEdge.target,
                      qualifiedName: `HR.MISSING_${options.offset}`,
                    },
                  },
                ]
              : [],
        },
      }),
    );
    const user = userEvent.setup();
    render(<HealthPanel onOpenEvidence={vi.fn()} />);

    expect(await screen.findByText(/HR\.MISSING_0/)).toBeInTheDocument();
    expect(screen.getByText("Showing 1–25 of 60")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/HR\.MISSING_25/)).toBeInTheDocument();
    expect(getPlsqlHealth).toHaveBeenLastCalledWith(undefined, {
      category: "unresolved",
      limit: 25,
      offset: 25,
    });

    // Another category restarts at its first page.
    await user.click(
      screen.getByRole("button", { name: /Ambiguous references/ }),
    );
    await waitFor(() =>
      expect(getPlsqlHealth).toHaveBeenLastCalledWith(undefined, {
        category: "ambiguous",
        limit: 25,
        offset: 0,
      }),
    );
  });
});
