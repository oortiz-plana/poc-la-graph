import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencySummary,
  PlsqlImpactResult,
  PlsqlObject,
  PlsqlObjectReference,
} from "@/lib/contracts";
import { OverviewPanel } from "./overview-panel";

const getPlsqlImpact = vi.hoisted(() => vi.fn());
const getPlsqlDependencies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlImpact, getPlsqlDependencies }));

function ref(
  id: string,
  kind: PlsqlObjectReference["kind"],
  name: string,
  qualifiedName: string,
): PlsqlObjectReference {
  return { id, kind, name, schema: "HR", qualifiedName };
}

const getSalary: PlsqlObject = {
  id: "plsql://sample/HR/FUNCTION/GET_SALARY",
  kind: "Function",
  name: "GET_SALARY",
  schema: "HR",
  qualifiedName: "HR.PKG_EMP.GET_SALARY",
  projectId: "sample",
  owner: "PKG_EMP",
  signature: null,
  returnType: null,
  declaration: null,
};

const runPayroll = ref(
  "plsql://sample/HR/PROCEDURE/RUN_PAYROLL",
  "Procedure",
  "RUN_PAYROLL",
  "HR.PKG_PAYROLL.RUN_PAYROLL",
);
const applyIva = ref(
  "plsql://sample/HR/FUNCTION/APPLY_IVA",
  "Function",
  "APPLY_IVA",
  "HR.PKG_PAYROLL.APPLY_IVA",
);
const generarReporte = ref(
  "plsql://sample/HR/PROCEDURE/GENERAR_REPORTE",
  "Procedure",
  "GENERAR_REPORTE",
  "HR.PKG_REPORTES.GENERAR_REPORTE",
);
const employees = ref(
  "plsql://sample/HR/TABLE/EMPLOYEES",
  "Table",
  "EMPLOYEES",
  "HR.EMPLOYEES",
);

function callsEdge(
  source: PlsqlObjectReference,
  target: PlsqlObjectReference,
  evidence: PlsqlDependency["evidence"] = null,
): PlsqlDependency {
  return {
    id: `edge://sample/CALLS/${source.name}/${target.name}`,
    relationship: "CALLS",
    resolution: "EXACT",
    source,
    target,
    evidence,
  };
}

const directCallEvidence = {
  sourceFileId: "file://sample/hr/pkg_payroll.pkb",
  path: "hr/pkg_payroll.pkb",
  startLine: 34,
  startColumn: 1,
  startOffset: 100,
  endOffset: 120,
};

const impactResult: PlsqlImpactResult = {
  object: ref(getSalary.id, "Function", "GET_SALARY", getSalary.qualifiedName),
  items: [
    {
      id: "impact://sample/direct",
      dependent: runPayroll,
      distance: 1,
      paths: [
        {
          id: "path://sample/direct",
          nodes: [runPayroll, getSalary],
          relationships: [callsEdge(runPayroll, getSalary, directCallEvidence)],
          hopCount: 1,
        },
      ],
    },
    {
      id: "impact://sample/indirect",
      dependent: generarReporte,
      distance: 2,
      paths: [
        {
          id: "path://sample/indirect",
          nodes: [generarReporte, runPayroll, getSalary],
          relationships: [
            callsEdge(generarReporte, runPayroll),
            callsEdge(runPayroll, getSalary),
          ],
          hopCount: 2,
        },
      ],
    },
  ],
  truncated: false,
  count: 2,
  summary: { direct: 1, indirect: 1, packages: 2, tablesModified: 0 },
};

function dependencySummary(
  category: "callees" | "reads" | "writes",
  items: PlsqlDependency[],
): PlsqlDependencySummary {
  return {
    counts: { callers: 1, callees: 1, reads: 1, writes: 0, other: 0 },
    items,
    truncated: false,
    total: items.length,
  };
}

const onOpenEvidence = vi.fn();
const onInspectPath = vi.fn();
const onAnalyzeObject = vi.fn();
const onExploreDependencies = vi.fn();
const onExploreImpact = vi.fn();

function renderPanel(object: PlsqlObject = getSalary) {
  return render(
    <OverviewPanel
      object={object}
      onOpenEvidence={onOpenEvidence}
      onInspectPath={onInspectPath}
      onAnalyzeObject={onAnalyzeObject}
      onExploreDependencies={onExploreDependencies}
      onExploreImpact={onExploreImpact}
    />,
  );
}

describe("OverviewPanel", () => {
  afterEach(() => {
    getPlsqlImpact.mockReset();
    getPlsqlDependencies.mockReset();
    onOpenEvidence.mockReset();
    onInspectPath.mockReset();
    onAnalyzeObject.mockReset();
    onExploreDependencies.mockReset();
    onExploreImpact.mockReset();
  });

  it("shows routine-relevant metrics for a Function, with Direct callers active by default", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    expect(
      await screen.findByRole("button", { name: /Direct callers/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const cards = within(
      screen.getByRole("group", { name: "Overview metrics" }),
    );
    for (const label of [
      "Direct callers",
      "Indirect callers",
      "Callees",
      "Tables read",
      "Tables modified",
    ]) {
      expect(
        cards.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    // Never shows metrics that don't apply to a routine.
    expect(
      cards.queryByRole("button", { name: /Readers/ }),
    ).not.toBeInTheDocument();
    expect(
      cards.queryByRole("button", { name: /Triggers/ }),
    ).not.toBeInTheDocument();

    expect(getPlsqlImpact).toHaveBeenCalledWith(
      getSalary.id,
      expect.objectContaining({ direction: "upstream", relationship: "CALLS" }),
    );
  });

  it("shows table-relevant metrics for a Table object", async () => {
    const table: PlsqlObject = {
      ...getSalary,
      id: employees.id,
      kind: "Table",
      name: "EMPLOYEES",
      qualifiedName: "HR.EMPLOYEES",
      owner: null,
    };
    getPlsqlImpact.mockResolvedValue({
      ...impactResult,
      object: ref(table.id, "Table", table.name, table.qualifiedName),
    });
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("reads", [callsEdge(runPayroll, table)]),
    );
    renderPanel(table);

    const cards = within(
      await screen.findByRole("group", { name: "Overview metrics" }),
    );
    for (const label of [
      "Direct dependents",
      "Indirect dependents",
      "Readers",
      "Writers",
      "Triggers",
    ]) {
      expect(
        cards.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    expect(
      cards.queryByRole("button", { name: /Callees/ }),
    ).not.toBeInTheDocument();
    expect(getPlsqlImpact).toHaveBeenCalledWith(
      table.id,
      expect.objectContaining({
        direction: "upstream",
        relationship: undefined,
      }),
    );
  });

  it("shows the Direct callers detail table with a Relationship column", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    const table = await screen.findByRole("table", { name: /Direct callers/ });
    expect(
      within(table).getByRole("columnheader", { name: "Relationship" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("RUN_PAYROLL")).toBeInTheDocument();
    expect(
      within(table).queryByText("GENERAR_REPORTE"),
    ).not.toBeInTheDocument();
  });

  it("switches to Indirect callers and shows a Distance column", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });

    await user.click(screen.getByRole("button", { name: /Indirect callers/ }));
    expect(
      screen.getByRole("button", { name: /Indirect callers/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Direct callers/ }),
    ).toHaveAttribute("aria-pressed", "false");

    const table = screen.getByRole("table", { name: /Indirect callers/ });
    expect(
      within(table).getByRole("columnheader", { name: "Distance" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("GENERAR_REPORTE")).toBeInTheDocument();
    expect(within(table).getByText("2 hops")).toBeInTheDocument();
  });

  it("lazily loads a category not yet fetched when its card is selected", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockImplementation((_objectId, category) =>
      Promise.resolve(
        dependencySummary(
          category as "callees" | "reads" | "writes",
          category === "reads" ? [callsEdge(getSalary, employees)] : [],
        ),
      ),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });
    expect(getPlsqlDependencies).toHaveBeenCalledWith(getSalary.id, "callees");
    expect(getPlsqlDependencies).not.toHaveBeenCalledWith(
      getSalary.id,
      "reads",
    );

    await user.click(screen.getByRole("button", { name: /Tables read/ }));
    await waitFor(() =>
      expect(getPlsqlDependencies).toHaveBeenCalledWith(getSalary.id, "reads"),
    );
    expect(
      await screen.findByRole("table", { name: /Tables read/ }),
    ).toHaveTextContent("EMPLOYEES");
  });

  it("selects a row and shows why it is related, with source/path/analyze actions", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });

    await user.click(screen.getByText("RUN_PAYROLL"));
    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ path: "hr/pkg_payroll.pkb", startLine: 34 }),
    );

    await user.click(screen.getByRole("button", { name: "View path" }));
    expect(onInspectPath).toHaveBeenCalledWith(
      expect.objectContaining({ id: "path://sample/direct" }),
    );

    await user.click(screen.getByRole("button", { name: "Analyze object" }));
    expect(onAnalyzeObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "RUN_PAYROLL" }),
    );
  });

  it("preserves the selected card and row while switching away and back is not required for evidence actions", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });
    await user.click(screen.getByText("RUN_PAYROLL"));
    await screen.findByText("Why is this affected?");

    await user.click(screen.getByRole("button", { name: "Open source" }));
    // Selection survives the action: still on Direct callers, row still shown.
    expect(
      screen.getByRole("button", { name: /Direct callers/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Why is this affected?")).toBeInTheDocument();
  });

  it("opens Dependencies with the metric's category filter applied", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });
    await user.click(screen.getByRole("button", { name: /Callees/ }));
    await screen.findByRole("table", { name: /Callees/ });

    await user.click(
      screen.getByRole("button", { name: "View all in Dependencies" }),
    );
    expect(onExploreDependencies).toHaveBeenCalledWith("callees");
  });

  it("offers View all in Impact for impact-sourced metrics instead", async () => {
    getPlsqlImpact.mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "View all in Impact" }));
    expect(onExploreImpact).toHaveBeenCalled();
  });

  it("shows an empty state for a metric with no rows", async () => {
    getPlsqlImpact.mockResolvedValue({
      ...impactResult,
      items: [],
      summary: { direct: 0, indirect: 0, packages: 0, tablesModified: 0 },
    });
    getPlsqlDependencies.mockResolvedValue(dependencySummary("callees", []));
    renderPanel();
    expect(await screen.findByText("No direct callers")).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    getPlsqlImpact
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry analysis query" }));
    expect(
      await screen.findByRole("table", { name: /Direct callers/ }),
    ).toBeInTheDocument();
  });
});
