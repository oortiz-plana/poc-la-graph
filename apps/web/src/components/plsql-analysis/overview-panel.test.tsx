import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencySummary,
  PlsqlImpactResult,
  PlsqlObject,
  PlsqlObjectReference,
} from "@/lib/contracts";
import { OverviewPanel } from "./overview-panel";

const getPlsqlImpact = vi.hoisted(() => vi.fn());
const getPlsqlImpactSummary = vi.hoisted(() => vi.fn());
const getPlsqlDependencies = vi.hoisted(() => vi.fn());
const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  getPlsqlImpact,
  getPlsqlImpactSummary,
  getPlsqlDependencies,
  getPlsqlFileSource,
}));

vi.mock("../auth-provider", () => ({
  useAuth: () => ({
    username: "tester",
    roles: new Set<string>(),
    logout: vi.fn(),
    config: { plsqlEnabled: true, plsqlMaxHops: 8 },
  }),
}));

// Monaco needs a real browser layout engine, so render the joined source
// lines as plain text in jsdom instead of loading the real editor.
vi.mock("./monaco-source-editor", () => ({
  default: (props: { value?: string }) => (
    <pre data-testid="monaco-source-editor">{props.value ?? ""}</pre>
  ),
}));

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
  nextCursor: null,
};

const impactSummary = {
  direct: 1,
  indirect: 1,
  packages: 2,
  tablesModified: 0,
};

/** A stand-in for the server: filters the items by the requested `scope` before paging. */
function mockImpactServer(result: PlsqlImpactResult) {
  getPlsqlImpact.mockImplementation(
    async (_id: string, options?: { scope?: string }) => {
      const items = result.items.filter((item) =>
        options?.scope === "direct"
          ? item.distance === 1
          : options?.scope === "indirect"
            ? item.distance > 1
            : true,
      );
      return { ...result, items, count: items.length };
    },
  );
}

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
const onExploreDependencies = vi.fn();
const onExploreImpact = vi.fn();

function renderPanel(
  object: PlsqlObject = getSalary,
  overrides: {
    onInspectObject?: (reference: PlsqlObjectReference) => void;
    onInspectEdge?: (edge: PlsqlDependency) => void;
    groupByPackage?: boolean;
  } = {},
) {
  return render(
    <OverviewPanel
      object={object}
      groupByPackage={overrides.groupByPackage ?? false}
      onOpenEvidence={onOpenEvidence}
      onInspectObject={overrides.onInspectObject}
      onInspectEdge={overrides.onInspectEdge}
      onInspectPath={onInspectPath}
      onExploreDependencies={onExploreDependencies}
      onExploreImpact={onExploreImpact}
    />,
  );
}

describe("OverviewPanel", () => {
  beforeEach(() => {
    getPlsqlImpactSummary.mockResolvedValue({
      object: impactResult.object,
      summary: impactSummary,
    });
  });

  afterEach(() => {
    getPlsqlImpact.mockReset();
    getPlsqlImpactSummary.mockReset();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
    onOpenEvidence.mockReset();
    onInspectPath.mockReset();
    onExploreDependencies.mockReset();
    onExploreImpact.mockReset();
  });

  it("shows routine-relevant metrics for a Function, with Direct callers active by default", async () => {
    mockImpactServer(impactResult);
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
    mockImpactServer({
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

  it("counts only triggers on the Triggers card of a Table, before it is opened", async () => {
    const table: PlsqlObject = {
      ...getSalary,
      id: employees.id,
      kind: "Table",
      name: "EMPLOYEES",
      qualifiedName: "HR.EMPLOYEES",
      owner: null,
    };
    const trigger = ref(
      "plsql://sample/HR/TRIGGER/TRG_EMPLOYEES_AUDIT",
      "Trigger",
      "TRG_EMPLOYEES_AUDIT",
      "HR.TRG_EMPLOYEES_AUDIT",
    );
    mockImpactServer({
      ...impactResult,
      object: ref(table.id, "Table", table.name, table.qualifiedName),
    });
    const triggerEdge = {
      ...callsEdge(trigger, table),
      relationship: "TRIGGER_ON" as const,
    };
    getPlsqlDependencies.mockImplementation(
      (
        _objectId: string,
        category: string,
        options?: { relationship?: string },
      ) =>
        // "other" mixes relationships (one trigger, two foreign keys); the
        // server narrows the page and its total, never the counts.
        Promise.resolve({
          counts: { callers: 0, callees: 0, reads: 0, writes: 0, other: 3 },
          items:
            category === "other" && options?.relationship === "TRIGGER_ON"
              ? [triggerEdge]
              : [],
          truncated: false,
          total:
            category === "other"
              ? options?.relationship === "TRIGGER_ON"
                ? 1
                : 3
              : 0,
        } satisfies PlsqlDependencySummary),
    );
    renderPanel(table);

    const triggers = await screen.findByRole("button", { name: /Triggers/ });
    await waitFor(() => expect(triggers).toHaveTextContent("1"));
    expect(triggers).not.toHaveTextContent("3");
    expect(getPlsqlDependencies).toHaveBeenCalledWith(
      table.id,
      "other",
      expect.objectContaining({ relationship: "TRIGGER_ON" }),
    );
  });

  it("shows the Direct callers detail table with a Relationship column", async () => {
    mockImpactServer(impactResult);
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
    mockImpactServer(impactResult);
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

  it("reads a category's rows only once its card is selected", async () => {
    mockImpactServer(impactResult);
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
    // Only the counts are fetched up front (one row of one category).
    expect(getPlsqlDependencies).toHaveBeenCalledWith(getSalary.id, "callees", {
      limit: 1,
    });
    expect(getPlsqlDependencies).not.toHaveBeenCalledWith(
      getSalary.id,
      "reads",
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: /Tables read/ }));
    await waitFor(() =>
      expect(getPlsqlDependencies).toHaveBeenCalledWith(
        getSalary.id,
        "reads",
        expect.objectContaining({ limit: 25, offset: 0 }),
      ),
    );
    expect(
      await screen.findByRole("table", { name: /Tables read/ }),
    ).toHaveTextContent("EMPLOYEES");
  });

  it("re-reads the list in package order, from page one, when grouping by package", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    const element = (groupByPackage: boolean) => (
      <OverviewPanel
        object={getSalary}
        groupByPackage={groupByPackage}
        onOpenEvidence={onOpenEvidence}
        onInspectPath={onInspectPath}
        onExploreDependencies={onExploreDependencies}
        onExploreImpact={onExploreImpact}
      />
    );
    const { rerender } = render(element(false));
    await screen.findByRole("table", { name: /Direct callers/ });
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      getSalary.id,
      expect.objectContaining({ order: "name", offset: 0 }),
    );

    rerender(element(true));
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        getSalary.id,
        expect.objectContaining({ order: "package", offset: 0 }),
      ),
    );
  });

  it("folds package and kind under the name while a row's detail is open", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    getPlsqlFileSource.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPanel();
    const table = await screen.findByRole("table", { name: /Direct callers/ });
    expect(
      within(table).getByRole("columnheader", { name: "Package" }),
    ).toBeInTheDocument();

    await user.click(screen.getByText("RUN_PAYROLL"));
    await screen.findByText("Why is this affected?");
    const narrow = screen.getByRole("table", { name: /Direct callers/ });
    expect(
      within(narrow).queryByRole("columnheader", { name: "Package" }),
    ).toBeNull();
    expect(
      within(narrow).queryByRole("columnheader", { name: "Type" }),
    ).toBeNull();
    expect(
      within(narrow).getByRole("columnheader", { name: "Evidence" }),
    ).toBeInTheDocument();
    // A missing source file is a quiet notice, not an alarming error.
    expect(
      await screen.findByText(
        /source code for this location is not available/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("selects a row and shows why it is related, with source/path/analyze actions", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
      },
      lines: ["  GET_SALARY(...);"],
      highlight: { startLine: 34, endLine: 34 },
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });

    await user.click(screen.getByText("RUN_PAYROLL"));
    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();
    // The full path/line lives once, in the source evidence header; the
    // relationship pane shows just the line number. (The detail table's
    // Evidence column also shows "line 34", so there are two.)
    expect(screen.getAllByText("line 34").length).toBeGreaterThan(0);
    expect(await screen.findByText("Source evidence")).toBeInTheDocument();

    // Open / analyze actions live in the Inspector, not in this panel.
    expect(screen.queryByRole("button", { name: "Open object" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open full source" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ path: "hr/pkg_payroll.pkb", startLine: 34 }),
    );

    await user.click(screen.getByRole("button", { name: "View path" }));
    expect(onInspectPath).toHaveBeenCalledWith(
      expect.objectContaining({ id: "path://sample/direct" }),
    );

    expect(screen.queryByRole("button", { name: /Analyze impact/ })).toBeNull();
  });

  it("shows an Evidence column, inspects a trail node in place, and closes the detail", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
      },
      lines: ["  GET_SALARY(...);"],
      highlight: { startLine: 34, endLine: 34 },
    });
    const onInspectObject = vi.fn();
    const onInspectEdge = vi.fn();
    const user = userEvent.setup();
    renderPanel(getSalary, { onInspectObject, onInspectEdge });

    const table = await screen.findByRole("table", { name: /Direct callers/ });
    expect(
      within(table).getByRole("columnheader", { name: "Evidence" }),
    ).toBeInTheDocument();

    await user.click(screen.getByText("RUN_PAYROLL"));
    await screen.findByText("Why is this affected?");

    // Clicking a node in the trail inspects it in place instead of navigating.
    await user.click(
      screen.getByRole("button", { name: "HR.PKG_EMP.GET_SALARY" }),
    );
    expect(onInspectObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "GET_SALARY" }),
    );

    await user.click(screen.getByRole("button", { name: "CALLS" }));
    expect(onInspectEdge).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: "CALLS" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Close why RUN_PAYROLL is related" }),
    );
    expect(screen.queryByText("Why is this affected?")).not.toBeInTheDocument();
  });

  it("preserves the selected card and row while switching away and back is not required for evidence actions", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
      },
      lines: ["  GET_SALARY(...);"],
      highlight: { startLine: 34, endLine: 34 },
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("table", { name: /Direct callers/ });
    await user.click(screen.getByText("RUN_PAYROLL"));
    await screen.findByText("Why is this affected?");

    await user.click(screen.getByRole("button", { name: "Open full source" }));
    // Selection survives the action: still on Direct callers, row still shown.
    expect(
      screen.getByRole("button", { name: /Direct callers/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Why is this affected?")).toBeInTheDocument();
  });

  it("opens Dependencies with the metric's category filter applied", async () => {
    mockImpactServer(impactResult);
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
    mockImpactServer(impactResult);
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
    mockImpactServer({ ...impactResult, items: [] });
    getPlsqlImpactSummary.mockResolvedValue({
      object: impactResult.object,
      summary: { direct: 0, indirect: 0, packages: 0, tablesModified: 0 },
    });
    getPlsqlDependencies.mockResolvedValue(dependencySummary("callees", []));
    renderPanel();
    expect(await screen.findByText("No direct callers")).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockRejectedValueOnce({
      code: "analysis_unavailable",
    });
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
  it("keeps the dependency cards and rows when the impact totals fail", async () => {
    mockImpactServer(impactResult);
    getPlsqlImpactSummary
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue({
        object: impactResult.object,
        summary: impactSummary,
      });
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    expect(
      await screen.findByRole("table", { name: /Direct callers/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry analysis query" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("—")).toBeNull();
  });

  it("navigates impact pages by number, previous and next", async () => {
    const user = userEvent.setup();
    const [, indirect] = impactResult.items;
    const named = (name: string, index: number) => ({
      ...indirect,
      id: `impact://sample/indirect-${index}`,
      dependent: ref(
        `plsql://sample/HR/PROCEDURE/${name}`,
        "Procedure",
        name,
        `HR.${name}`,
      ),
    });
    getPlsqlImpactSummary.mockResolvedValue({
      object: impactResult.object,
      summary: { ...impactSummary, indirect: 60 },
    });
    getPlsqlImpact.mockImplementation(
      async (_id: string, options?: { offset?: number }) => ({
        ...impactResult,
        items: [
          named(
            `PAGE_${(options?.offset ?? 0) / 25 + 1}`,
            options?.offset ?? 0,
          ),
        ],
        count: 60,
      }),
    );
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Indirect callers/ }),
    );
    expect(await screen.findByText("PAGE_1")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("PAGE_2")).toBeInTheDocument();
    expect(screen.queryByText("PAGE_1")).toBeNull();
    expect(screen.getByText("Showing 26–50 of 60")).toBeInTheDocument();
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      getSalary.id,
      expect.objectContaining({ offset: 25, limit: 25, scope: "indirect" }),
    );
    expect(getPlsqlImpact).not.toHaveBeenCalledWith(
      getSalary.id,
      expect.objectContaining({ cursor: expect.anything() }),
    );

    await user.click(screen.getByRole("button", { name: "Go to page 3" }));
    expect(await screen.findByText("PAGE_3")).toBeInTheDocument();
    expect(screen.getByText("Showing 51–60 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("PAGE_2")).toBeInTheDocument();
  });

  it("pages the rows of a dependency card too and restarts on another card", async () => {
    const user = userEvent.setup();
    const reader = (index: number) => ({
      ...callsEdge(getSalary, employees),
      id: `edge://sample/READS/${index}`,
      target: ref(
        `plsql://sample/HR/TABLE/T${index}`,
        "Table",
        `T${index}`,
        `HR.T${index}`,
      ),
    });
    getPlsqlDependencies.mockImplementation(
      async (
        _id: string,
        category: string,
        options?: { offset?: number; limit?: number },
      ) => ({
        counts: { callers: 0, callees: 1, reads: 30, writes: 0, other: 0 },
        items:
          category === "reads" && options?.limit === 25
            ? [reader(options.offset ?? 0)]
            : [],
        truncated: false,
        total: category === "reads" ? 30 : 1,
      }),
    );
    mockImpactServer(impactResult);
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Tables read/ }),
    );
    expect(await screen.findByText("T0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("T25")).toBeInTheDocument();
    expect(getPlsqlDependencies).toHaveBeenLastCalledWith(
      getSalary.id,
      "reads",
      expect.objectContaining({ offset: 25 }),
    );

    await user.click(screen.getByRole("button", { name: /Direct callers/ }));
    await user.click(screen.getByRole("button", { name: /Tables read/ }));
    expect(await screen.findByText("T0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps the shown page and offers a retry when the next page fails", async () => {
    const user = userEvent.setup();
    let failing = false;
    getPlsqlImpact.mockImplementation(
      async (_id: string, options?: { offset?: number; scope?: string }) => {
        if (options?.scope !== "direct") return impactResult;
        if (failing && options.offset) throw { code: "analysis_unavailable" };
        return { ...impactResult, items: [impactResult.items[0]], count: 40 };
      },
    );
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();
    await screen.findByText("RUN_PAYROLL");

    failing = true;
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByText("Could not load this page."),
    ).toBeInTheDocument();
    expect(screen.getByText("RUN_PAYROLL")).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("Could not load this page.")).toBeNull(),
    );
    expect(screen.getByText("Showing 26–40 of 40")).toBeInTheDocument();
  });

  it("asks the server for the indirect dependents instead of filtering the first page", async () => {
    const user = userEvent.setup();
    const [direct, indirect] = impactResult.items;
    // The unfiltered first page is all direct dependents (they sort first),
    // so the indirect rows exist only behind the server-side scope.
    getPlsqlImpact.mockImplementation(
      async (_id: string, options?: { scope?: string }) =>
        options?.scope === "indirect"
          ? { ...impactResult, items: [indirect], count: 1 }
          : { ...impactResult, items: [direct], count: 2 },
    );
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Indirect callers/ }),
    );
    const table = await screen.findByRole("table", {
      name: /Indirect callers/,
    });
    expect(
      await within(table).findByText("GENERAR_REPORTE"),
    ).toBeInTheDocument();
    expect(getPlsqlImpact).toHaveBeenCalledWith(
      getSalary.id,
      expect.objectContaining({ scope: "indirect" }),
    );
  });

  it("reloads the dependents with the depth the user enters", async () => {
    const user = userEvent.setup();
    mockImpactServer(impactResult);
    getPlsqlDependencies.mockResolvedValue(
      dependencySummary("callees", [callsEdge(getSalary, applyIva)]),
    );
    renderPanel();

    const depth = await screen.findByRole("spinbutton", { name: "Depth" });
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      getSalary.id,
      expect.objectContaining({ depth: 5 }),
    );

    await user.clear(depth);
    await user.type(depth, "12{Enter}");

    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        getSalary.id,
        expect.objectContaining({ depth: 8 }),
      ),
    );
  });
});
