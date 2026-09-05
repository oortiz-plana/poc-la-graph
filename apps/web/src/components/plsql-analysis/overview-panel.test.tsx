import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlOverview } from "@/lib/contracts";
import { OverviewPanel } from "./overview-panel";

const getPlsqlOverview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlOverview }));

const overview: PlsqlOverview = {
  object: {
    id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
    kind: "Function",
    name: "DOCU_FIDE",
    schema: "HR",
    qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
  },
  directDependents: 2,
  indirectDependents: 74,
  callers: 2,
  callees: 0,
  tablesAccessed: 0,
  topCallers: [
    {
      id: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
      kind: "Function",
      name: "CALC_IVA_MORA",
      schema: "HR",
      qualifiedName: "HR.FA_QFACT_CALC.CALC_IVA_MORA",
    },
    {
      id: "plsql://sample/HR/FUNCTION/VALOR_MORA_PRO_IVA",
      kind: "Function",
      name: "VALOR_MORA_PRO_IVA",
      schema: "HR",
      qualifiedName: "HR.FA_QFACT_CALC.VALOR_MORA_PRO_IVA",
    },
  ],
};

function renderPanel() {
  return render(
    <OverviewPanel
      objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
      onOpenObject={vi.fn()}
      onExploreDependencies={vi.fn()}
    />,
  );
}

describe("OverviewPanel", () => {
  afterEach(() => getPlsqlOverview.mockReset());

  it("renders the headline metric cards", async () => {
    getPlsqlOverview.mockResolvedValue(overview);
    renderPanel();
    expect(await screen.findByText("74")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBe(2);
    expect(screen.getByText("Direct dependents")).toBeInTheDocument();
    expect(screen.getByText("Indirect dependents")).toBeInTheDocument();
    expect(screen.getByText("Callers")).toBeInTheDocument();
    expect(screen.getByText("Callees")).toBeInTheDocument();
    expect(screen.getByText("Tables accessed")).toBeInTheDocument();
    expect(getPlsqlOverview).toHaveBeenCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
    );
  });

  it("lists direct callers and reports selection", async () => {
    const onOpenObject = vi.fn();
    getPlsqlOverview.mockResolvedValue(overview);
    render(
      <OverviewPanel
        objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
        onOpenObject={onOpenObject}
        onExploreDependencies={vi.fn()}
      />,
    );
    await screen.findByText("CALC_IVA_MORA");
    await userEvent.setup().click(
      screen.getByRole("button", { name: /VALOR_MORA_PRO_IVA/ }),
    );
    expect(onOpenObject).toHaveBeenCalledWith(overview.topCallers[1]);
  });

  it("offers the dependencies deep link", async () => {
    const onExploreDependencies = vi.fn();
    getPlsqlOverview.mockResolvedValue(overview);
    render(
      <OverviewPanel
        objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
        onOpenObject={vi.fn()}
        onExploreDependencies={onExploreDependencies}
      />,
    );
    await screen.findByText("CALC_IVA_MORA");
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Explore dependencies/ }),
    );
    expect(onExploreDependencies).toHaveBeenCalled();
  });

  it("shows an empty callers state", async () => {
    getPlsqlOverview.mockResolvedValue({ ...overview, callers: 0, topCallers: [] });
    renderPanel();
    expect(await screen.findByText("No direct callers")).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    getPlsqlOverview
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue(overview);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    expect(await screen.findByText("74")).toBeInTheDocument();
  });
});
