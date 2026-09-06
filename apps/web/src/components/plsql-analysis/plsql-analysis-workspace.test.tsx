import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlImpactResult,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlObjectSearchResult,
  PlsqlPath,
  PlsqlPathResult,
  PlsqlSourceContent,
} from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  searchPlsqlObjects: vi.fn(),
  getPlsqlDependencies: vi.fn(),
  findPlsqlPaths: vi.fn(),
  getPlsqlObjectSource: vi.fn(),
  getPlsqlFileSource: vi.fn(),
  getPlsqlImpact: vi.fn(),
  getPlsqlOverview: vi.fn(),
  getPlsqlHealth: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  config: { plsqlEnabled: true },
}));

vi.mock("@/lib/api", () => mocks);
vi.mock("../auth-provider", () => ({
  useAuth: () => ({
    username: "plsql-analyst",
    roles: new Set(["viewer", "editor"]),
    logout: vi.fn(),
    config: authState.config,
  }),
}));
// Monaco needs a real browser layout engine, so render the joined source lines
// as plain text in jsdom and assert the source viewer wires them into the
// editor.
vi.mock("./monaco-source-editor", () => ({
  default: (props: { value?: string }) =>
    React.createElement(
      "pre",
      { "data-testid": "monaco-source-editor" },
      props.value ?? "",
    ),
}));

import { PlsqlAnalysisWorkspace } from "./plsql-analysis-workspace";

const functionObject: PlsqlObject = {
  id: "plsql://sample/HR/FUNCTION/GET_SALARY",
  kind: "Function",
  name: "GET_SALARY",
  schema: "HR",
  qualifiedName: "HR.PKG_EMP.GET_SALARY",
  projectId: "sample",
  owner: "PKG_EMP",
  signature: "FUNCTION GET_SALARY(p_emp_id IN NUMBER) RETURN NUMBER",
  returnType: "NUMBER",
  declaration: {
    sourceFileId: "file://sample/hr/pkg_emp.pkb",
    path: "hr/pkg_emp.pkb",
    startLine: 42,
    startColumn: 3,
    startOffset: 512,
    endOffset: 600,
  },
};

const payrollObject: PlsqlObject = {
  ...functionObject,
  id: "plsql://sample/HR/PROCEDURE/RUN_PAYROLL",
  kind: "Procedure",
  name: "RUN_PAYROLL",
  qualifiedName: "HR.PKG_PAYROLL.RUN_PAYROLL",
  owner: "PKG_PAYROLL",
  signature: null,
  returnType: null,
  declaration: null,
};

function problemError(code: string): Error & { code: string } {
  const error = new Error("The analysis service is unavailable.") as Error & {
    code: string;
  };
  error.code = code;
  return error;
}

function referenceFixture(
  id: string,
  kind: PlsqlObjectReference["kind"],
  name: string,
  qualifiedName: string,
  schema = "HR",
): PlsqlObjectReference {
  return { id, kind, name, schema, qualifiedName };
}

function dependencyFixture(
  overrides: Partial<PlsqlDependency>,
): PlsqlDependency {
  return {
    id: "edge://sample/CALLS",
    relationship: "CALLS",
    resolution: "EXACT",
    source: referenceFixture(
      "plsql://sample/HR/PROCEDURE/RUN_PAYROLL",
      "Procedure",
      "RUN_PAYROLL",
      "HR.PKG_PAYROLL.RUN_PAYROLL",
    ),
    target: referenceFixture(
      functionObject.id,
      "Function",
      "GET_SALARY",
      functionObject.qualifiedName,
    ),
    evidence: null,
    ...overrides,
  };
}

function emptyImpactResult(): PlsqlImpactResult {
  return {
    object: referenceFixture(
      functionObject.id,
      "Function",
      "GET_SALARY",
      functionObject.qualifiedName,
    ),
    items: [],
    truncated: false,
    count: 0,
    summary: { direct: 0, indirect: 0, packages: 0, tablesModified: 0 },
  };
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Type into the explorer search and click a result row. */
async function selectFromExplorer(
  user: ReturnType<typeof userEvent.setup>,
  searchResult: PlsqlObjectSearchResult,
  rowName: RegExp | string,
) {
  mocks.searchPlsqlObjects.mockResolvedValue(searchResult);
  await user.type(screen.getByRole("searchbox"), "salary");
  await user.click(
    await screen.findByRole("button", { name: rowName }, { timeout: 5000 }),
  );
}

/** Pick one From/To path endpoint through its combobox listbox. */
async function pickPathObject(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
  queryText: string,
  optionName: string,
) {
  const field = screen.getByLabelText(fieldLabel) as HTMLInputElement;
  await user.type(field, queryText);
  await user.click(
    await screen.findByRole("option", { name: optionName }, { timeout: 5000 }),
  );
}

describe("PlsqlAnalysisWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.config = { plsqlEnabled: true };
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 0, callees: 0, reads: 0, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    mocks.getPlsqlHealth.mockResolvedValue({
      total: 0,
      unresolved: { count: 0, items: [] },
      ambiguous: { count: 0, items: [] },
      dynamicSql: { count: 0, items: [] },
      parseErrors: { count: 0, items: [] },
      unsupported: { count: 0, items: [] },
      truncated: false,
    });
    mocks.getPlsqlImpact.mockResolvedValue(emptyImpactResult());
    mocks.getPlsqlOverview.mockResolvedValue({
      object: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        functionObject.qualifiedName,
      ),
      directDependents: 0,
      indirectDependents: 0,
      callers: 0,
      callees: 0,
      tablesAccessed: 0,
      topCallers: [],
    });
    stubMatchMedia(true);
  });

  it("shows a non-interactive message when analysis is not configured", () => {
    authState.config = { plsqlEnabled: false };
    render(<PlsqlAnalysisWorkspace />);
    expect(
      screen.getByRole("heading", { name: "PL/SQL analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Analysis is not configured")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("renders the workspace panes with an empty state before selection", () => {
    render(<PlsqlAnalysisWorkspace />);
    expect(screen.getByLabelText("Object Explorer")).toBeInTheDocument();
    expect(screen.getByLabelText("Inspector")).toBeInTheDocument();
    expect(screen.getByText("No object selected")).toBeInTheDocument();
    expect(mocks.getPlsqlDependencies).not.toHaveBeenCalled();
  });

  it("shows the persistent header with breadcrumb", async () => {
    const user = userEvent.setup();
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );

    const heading = await screen.findByRole("heading", { name: "GET_SALARY" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getAllByText("Function").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Qualified name")).toHaveTextContent(
      "HR/PKG_EMP/GET_SALARY",
    );
    expect(
      screen.getByRole("button", { name: "Open source" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyze impact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Find path" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("drills down from an Overview metric into a related object's Impact tab", async () => {
    const user = userEvent.setup();
    const step = dependencyFixture({
      id: "edge://sample/CALLS/PAYROLL",
      source: referenceFixture(
        payrollObject.id,
        "Procedure",
        "RUN_PAYROLL",
        payrollObject.qualifiedName,
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 12,
        startColumn: 1,
        startOffset: 10,
        endOffset: 30,
      },
    });
    const path: PlsqlPath = {
      id: "path://sample/overview-1",
      nodes: [step.source, step.target],
      relationships: [step],
      hopCount: 1,
    };
    mocks.getPlsqlImpact.mockResolvedValue({
      object: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        functionObject.qualifiedName,
      ),
      items: [
        {
          id: "impact://sample/overview-d1",
          dependent: step.source,
          distance: 1,
          paths: [path],
        },
      ],
      truncated: false,
      count: 1,
      summary: { direct: 1, indirect: 0, packages: 1, tablesModified: 0 },
    });
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 0, callees: 2, reads: 0, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );

    expect(
      await screen.findByRole("button", { name: /Direct callers/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByText("RUN_PAYROLL"));
    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("hr/pkg_payroll.pkb:12")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Analyze object" }));
    expect(
      await screen.findByRole("heading", { name: "RUN_PAYROLL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Impact" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens Dependencies with a metric's category filter via Overview's View all link", async () => {
    const user = userEvent.setup();
    mocks.getPlsqlImpact.mockResolvedValue(emptyImpactResult());
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 0, callees: 2, reads: 0, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await screen.findByRole("button", { name: /Direct callers/ });

    await user.click(screen.getByRole("button", { name: /Callees/ }));
    await screen.findByText("No callees");
    await user.click(
      screen.getByRole("button", { name: "View all in Dependencies" }),
    );

    expect(
      await screen.findByRole("button", { name: /Callees 2/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: "Dependencies" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("loads the unified dependency view with category chips when the Dependencies tab opens", async () => {
    const user = userEvent.setup();
    const callEdge = dependencyFixture({
      resolution: "INFERRED",
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 34,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 1, callees: 0, reads: 0, writes: 0, other: 0 },
      items: [callEdge],
      truncated: false,
      total: 1,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));

    expect(mocks.getPlsqlDependencies).toHaveBeenCalledWith(
      functionObject.id,
      "callers",
    );
    expect(
      await screen.findByRole("button", { name: /Callers 1/ }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const rows = screen.getAllByRole("listitem");
      expect(
        rows.some((row) => {
          const text = row.textContent ?? "";
          return (
            text.includes("RUN_PAYROLL") &&
            text.includes("CALLS") &&
            text.includes("GET_SALARY")
          );
        }),
      ).toBe(true);
    });
    expect(screen.getByText("Inferred")).toBeInTheDocument();
    expect(screen.getByText("Inferred")).toHaveAttribute(
      "title",
      "Confidence: INFERRED",
    );
    expect(screen.getByText("hr/pkg_payroll.pkb:34")).toBeInTheDocument();
  });

  it("inspects a dependency split-view node and edge without resetting the panel", async () => {
    const user = userEvent.setup();
    const callEdge = dependencyFixture({
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 34,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 1, callees: 0, reads: 0, writes: 0, other: 0 },
      items: [callEdge],
      truncated: false,
      total: 1,
    });
    mocks.getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
      },
      lines: ["  RUN_PAYROLL(...);"],
      highlight: { startLine: 34, endLine: 34 },
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));
    await user.click(
      await screen.findByRole("button", {
        name: /Show dependency details for/,
      }),
    );
    expect(await screen.findByText("Dependency")).toBeInTheDocument();

    // A node in the split view's trail inspects it in place; it must not
    // navigate away and reset the panel back to its default category.
    // Selecting the row above already put the same node in the Inspector as
    // its own link, so scope to the main pane to click the trail's copy.
    const main = screen.getByRole("main", { name: "Analysis workspace" });
    await user.click(
      within(main).getByRole("button", { name: "HR.PKG_PAYROLL.RUN_PAYROLL" }),
    );
    const inspector = screen.getByLabelText("Inspector");
    expect(within(inspector).getByText("Object details")).toBeInTheDocument();
    expect(within(inspector).getByText("RUN_PAYROLL")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "GET_SALARY" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Callers 1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Dependency")).toBeInTheDocument();

    // The relationship line inspects the edge the same way.
    await user.click(screen.getByRole("button", { name: "CALLS" }));
    expect(within(inspector).getByText("Dependency edge")).toBeInTheDocument();
  });

  it("switches category chips and refetches the selected list", async () => {
    const user = userEvent.setup();
    const reads = dependencyFixture({
      id: "edge://sample/READS",
      relationship: "READS",
      resolution: "EXACT",
      source: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        functionObject.qualifiedName,
      ),
      target: referenceFixture(
        "plsql://sample/HR/TABLE/EMPLOYEES",
        "Table",
        "EMPLOYEES",
        "HR.EMPLOYEES",
      ),
    });
    // The Overview tab's own eager fetch (category "callees") runs first,
    // as soon as the object is selected, before the Dependencies tab opens.
    mocks.getPlsqlDependencies.mockResolvedValueOnce({
      counts: { callers: 0, callees: 0, reads: 1, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    mocks.getPlsqlDependencies.mockResolvedValueOnce({
      counts: { callers: 0, callees: 0, reads: 1, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    mocks.getPlsqlDependencies.mockResolvedValueOnce({
      counts: { callers: 0, callees: 0, reads: 1, writes: 0, other: 0 },
      items: [reads],
      truncated: true,
      total: 1,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));
    await user.click(await screen.findByRole("button", { name: /Reads 1/ }));

    expect(mocks.getPlsqlDependencies).toHaveBeenLastCalledWith(
      functionObject.id,
      "reads",
    );
    await waitFor(() => {
      const rows = screen.getAllByRole("listitem");
      expect(
        rows.some((row) => (row.textContent ?? "").includes("HR.EMPLOYEES")),
      ).toBe(true);
    });
    expect(screen.getByText("Results truncated")).toBeInTheDocument();
  });

  it("retries a failed dependencies query independently", async () => {
    const user = userEvent.setup();
    mocks.getPlsqlDependencies
      // The Overview tab's own eager fetch runs first, as soon as the
      // object is selected, before the Dependencies tab opens.
      .mockResolvedValueOnce({
        counts: { callers: 0, callees: 0, reads: 0, writes: 0, other: 0 },
        items: [],
        truncated: false,
        total: 0,
      })
      .mockRejectedValueOnce(problemError("analysis_unavailable"))
      .mockResolvedValue({
        counts: { callers: 0, callees: 0, reads: 0, writes: 0, other: 0 },
        items: [],
        truncated: false,
        total: 0,
      });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    expect(
      await screen.findByText("No matching dependencies"),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry in a dependency section", async () => {
    const user = userEvent.setup();
    mocks.getPlsqlDependencies.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
  });

  it("renders the impact report inside the Impact tab", async () => {
    const user = userEvent.setup();
    const step = dependencyFixture({
      id: "edge://sample/CALLS/PAYROLL",
      source: referenceFixture(
        payrollObject.id,
        "Procedure",
        "RUN_PAYROLL",
        payrollObject.qualifiedName,
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 12,
        startColumn: 1,
        startOffset: 10,
        endOffset: 30,
      },
    });
    const path: PlsqlPath = {
      id: "path://sample/impact-1",
      nodes: [step.source, step.target],
      relationships: [step],
      hopCount: 1,
    };
    mocks.getPlsqlImpact.mockResolvedValue({
      object: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        functionObject.qualifiedName,
      ),
      items: [
        {
          id: "impact://sample/d1",
          dependent: step.source,
          distance: 1,
          paths: [path],
        },
      ],
      truncated: false,
      count: 1,
      summary: { direct: 1, indirect: 0, packages: 1, tablesModified: 0 },
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Impact" }));

    expect(
      await screen.findByRole("heading", { name: "Impact analysis" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Direct")).toBeInTheDocument();
    expect(screen.getByText("Indirect dependents")).toBeInTheDocument();
    expect(screen.getByText("RUN_PAYROLL")).toBeInTheDocument();
    expect(screen.getByText("PKG_PAYROLL")).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();
    await user.click(screen.getByText("RUN_PAYROLL"));
    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("hr/pkg_payroll.pkb:12")).toBeInTheDocument();
  });

  it("shows the empty impact state and truncation flag", async () => {
    const user = userEvent.setup();
    mocks.getPlsqlImpact.mockResolvedValue({
      ...emptyImpactResult(),
      truncated: true,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Impact" }));
    expect(
      await screen.findByText("No impacted dependents"),
    ).toBeInTheDocument();
    expect(screen.getByText("Results truncated")).toBeInTheDocument();
  });

  it(
    "traces paths in the Paths tab and inspects a route node and edge in place",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const step = dependencyFixture({
        id: "edge://sample/CALLS/PAYROLL",
        source: referenceFixture(
          payrollObject.id,
          "Procedure",
          "RUN_PAYROLL",
          payrollObject.qualifiedName,
        ),
      });
      const path: PlsqlPath = {
        id: "path://sample/p1",
        nodes: [step.source, step.target],
        relationships: [step],
        hopCount: 1,
      };
      mocks.findPlsqlPaths.mockResolvedValue({
        items: [path],
        truncated: false,
        count: 1,
      } satisfies PlsqlPathResult);
      const payrollSearch = {
        items: [payrollObject],
        truncated: false,
        count: 1,
      };
      render(<PlsqlAnalysisWorkspace />);
      await selectFromExplorer(
        user,
        { items: [functionObject], truncated: false, count: 1 },
        /GET_SALARY/,
      );
      await user.click(screen.getByRole("tab", { name: "Paths" }));
      mocks.searchPlsqlObjects.mockResolvedValue(payrollSearch);
      expect(screen.getByLabelText("From object")).toHaveValue(
        "Function · HR.PKG_EMP.GET_SALARY",
      );
      await pickPathObject(
        user,
        "To object",
        "payroll",
        "Procedure · HR.PKG_PAYROLL.RUN_PAYROLL",
      );
      await user.click(screen.getByRole("button", { name: "Find paths" }));

      expect(await screen.findByText("1 hop")).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", {
          name: /GET_SALARY.*RUN_PAYROLL|RUN_PAYROLL.*GET_SALARY/,
        }),
      );
      expect(await screen.findByText("Route")).toBeInTheDocument();

      // Clicking a route node inspects it in the right-hand panel instead of
      // navigating away, so the traced route stays open and intact. Scoped
      // to the main pane: the Inspector already shows the same node (from
      // expanding the row above) as its own link with the same name.
      const main = screen.getByRole("main", { name: "Analysis workspace" });
      await user.click(
        within(main).getByRole("button", {
          name: "HR.PKG_PAYROLL.RUN_PAYROLL",
        }),
      );
      const inspector = screen.getByLabelText("Inspector");
      expect(within(inspector).getByText("Object details")).toBeInTheDocument();
      expect(within(inspector).getByText("RUN_PAYROLL")).toBeInTheDocument();
      expect(screen.getByText("Route")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "GET_SALARY" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "RUN_PAYROLL" }),
      ).not.toBeInTheDocument();

      // Clicking the relationship line inspects the edge the same way.
      await user.click(screen.getByRole("button", { name: "CALLS" }));
      expect(
        within(inspector).getByText("Dependency edge"),
      ).toBeInTheDocument();

      // Re-inspect the object, then jump to its Overview from the Inspector.
      await user.click(
        within(main).getByRole("button", {
          name: "HR.PKG_PAYROLL.RUN_PAYROLL",
        }),
      );
      await user.click(
        within(inspector).getByRole("button", { name: "RUN_PAYROLL" }),
      );
      expect(
        await screen.findByRole("heading", { name: "RUN_PAYROLL" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  );

  it(
    "requires distinct From and To objects before tracing",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      mocks.searchPlsqlObjects.mockResolvedValue({
        items: [functionObject],
        truncated: false,
        count: 1,
      });
      render(<PlsqlAnalysisWorkspace />);
      await selectFromExplorer(
        user,
        { items: [functionObject], truncated: false, count: 1 },
        /GET_SALARY/,
      );
      await user.click(screen.getByRole("tab", { name: "Paths" }));
      const optionName = "Function · HR.PKG_EMP.GET_SALARY";
      await pickPathObject(user, "To object", "salary", optionName);
      expect(screen.getByRole("button", { name: "Find paths" })).toBeDisabled();
    },
  );

  it("opens Analysis Health scoped to the selected object", async () => {
    const user = userEvent.setup();
    const unresolved = dependencyFixture({
      id: "edge://sample/CALLS/UNRESOLVED",
      resolution: "UNRESOLVED",
      source: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        functionObject.qualifiedName,
      ),
      target: referenceFixture(
        "plsql://sample/HR/PROCEDURE/MISSING",
        "Procedure",
        "MISSING",
        "HR.MISSING",
      ),
    });
    mocks.getPlsqlHealth.mockResolvedValue({
      total: 1,
      unresolved: { count: 1, items: [unresolved] },
      ambiguous: { count: 0, items: [] },
      dynamicSql: { count: 0, items: [] },
      parseErrors: { count: 0, items: [] },
      unsupported: { count: 0, items: [] },
      truncated: false,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("button", { name: /Analysis Health/ }));

    expect(
      await screen.findByRole("heading", { name: "Analysis Health" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getPlsqlHealth).toHaveBeenCalledWith(functionObject.id),
    );
    expect(await screen.findByText("Unresolved")).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("HR.MISSING")),
    ).toBeInTheDocument();
  });

  it("opens the object source viewer from the header action", async () => {
    const user = userEvent.setup();
    const content: PlsqlSourceContent = {
      file: { fileId: "file://sample/hr/pkg_emp.pkb", path: "hr/pkg_emp.pkb" },
      lines: ["  FUNCTION GET_SALARY(", "    RETURN 1000;", "  END;"],
      highlight: { startLine: 1, endLine: 1 },
    };
    mocks.getPlsqlObjectSource.mockResolvedValue(content);
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("button", { name: "Open source" }));

    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("heading", { name: "Source" }),
    ).toBeInTheDocument();
    expect(mocks.getPlsqlObjectSource).toHaveBeenCalledWith(functionObject.id);
    expect(
      (await screen.findAllByText("hr/pkg_emp.pkb")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Go to line 1" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("monaco-source-editor")).toHaveTextContent(
      "FUNCTION GET_SALARY(",
    );
  });

  it("opens the file source viewer from a caller evidence link", async () => {
    const user = userEvent.setup();
    const callEdge = dependencyFixture({
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 34,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 1, callees: 0, reads: 0, writes: 0, other: 0 },
      items: [callEdge],
      truncated: false,
      total: 1,
    });
    mocks.getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
      },
      lines: ["  GET_SALARY(...);"],
      highlight: { startLine: 34, endLine: 34 },
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));
    await user.click(await screen.findByText("hr/pkg_payroll.pkb:34"));

    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("hr/pkg_payroll.pkb")).toBeInTheDocument();
    expect(mocks.getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/pkg_payroll.pkb",
      { startLine: 34, endLine: 34 },
    );
  });

  it("opens the source viewer in a sheet drawer on narrow screens", async () => {
    const user = userEvent.setup();
    stubMatchMedia(false);
    mocks.getPlsqlObjectSource.mockResolvedValue({
      file: { fileId: "file://sample/hr/pkg_emp.pkb", path: "hr/pkg_emp.pkb" },
      lines: ["FUNCTION GET_SALARY"],
      highlight: { startLine: 1, endLine: 1 },
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject], truncated: false, count: 1 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("button", { name: "Open source" }));
    expect(
      await screen.findByRole("heading", { name: "Source" }),
    ).toBeInTheDocument();
    expect(
      document.getElementById("plsql-source-sheet-title"),
    ).toBeInTheDocument();
  });

  it("supports back and forward navigation between objects", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue({
      items: [functionObject, payrollObject],
      truncated: false,
      count: 2,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject, payrollObject], truncated: false, count: 2 },
      /GET_SALARY/,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /RUN_PAYROLL/ }));
    expect(
      await screen.findByRole("heading", { name: "RUN_PAYROLL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "GET_SALARY" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(
      await screen.findByRole("heading", { name: "RUN_PAYROLL" }),
    ).toBeInTheDocument();
  });

  it("switching objects keeps the active tab and refreshes its content", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue({
      items: [functionObject, payrollObject],
      truncated: false,
      count: 2,
    });
    render(<PlsqlAnalysisWorkspace />);
    await selectFromExplorer(
      user,
      { items: [functionObject, payrollObject], truncated: false, count: 2 },
      /GET_SALARY/,
    );
    await user.click(screen.getByRole("tab", { name: "Dependencies" }));
    expect(
      await screen.findByRole("button", { name: /Callers 0/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /RUN_PAYROLL/ }));
    expect(
      await screen.findByRole("heading", { name: "RUN_PAYROLL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dependencies" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(mocks.getPlsqlDependencies).toHaveBeenLastCalledWith(
        payrollObject.id,
        "callers",
      ),
    );
  });
});
