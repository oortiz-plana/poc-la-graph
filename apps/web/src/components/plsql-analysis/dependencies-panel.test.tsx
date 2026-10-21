import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencySummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import { DependenciesPanel } from "./dependencies-panel";

const getPlsqlDependencies = vi.hoisted(() => vi.fn());
const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlDependencies, getPlsqlFileSource }));

// Monaco needs a real browser layout engine, so render the joined source
// lines as plain text in jsdom instead of loading the real editor.
vi.mock("./monaco-source-editor", () => ({
  default: (props: { value?: string }) => (
    <pre data-testid="monaco-source-editor">{props.value ?? ""}</pre>
  ),
}));

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
  declaration: null,
};

function callerSummary(): PlsqlDependencySummary {
  return {
    counts: { callers: 1, callees: 0, reads: 0, writes: 0, other: 0 },
    items: [
      {
        id: "edge://sample/CALLS/1",
        relationship: "CALLS",
        resolution: "EXACT",
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
        evidence: null,
      },
    ],
    truncated: false,
    total: 1,
  };
}

function renderPanel(
  overrides: {
    onInspectObject?: (reference: PlsqlObjectReference) => void;
    onInspectEdge?: (edge: PlsqlDependency) => void;
    onInspectPath?: (path: PlsqlPath) => void;
    groupByPackage?: boolean;
    initialCategory?: "callers" | "callees" | "reads" | "writes" | "other";
  } = {},
) {
  return render(
    <DependenciesPanel
      object={object}
      initialCategory={overrides.initialCategory}
      groupByPackage={overrides.groupByPackage ?? false}
      onOpenEvidence={vi.fn()}
      onInspectObject={overrides.onInspectObject ?? vi.fn()}
      onInspectEdge={overrides.onInspectEdge}
      onInspectPath={overrides.onInspectPath}
    />,
  );
}

describe("DependenciesPanel categories", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
  });

  it("lists the categories as chips with their counts", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    renderPanel();
    expect(
      await screen.findByRole("button", { name: /Callers 1/ }),
    ).toBeInTheDocument();
    // The list is the only view: there is no graph toggle.
    expect(
      screen.queryByRole("button", { name: "Graph" }),
    ).not.toBeInTheDocument();
  });

  it("starts on a given category when arriving with one pre-applied", async () => {
    getPlsqlDependencies.mockResolvedValue({
      counts: { callers: 0, callees: 0, reads: 3, writes: 0, other: 0 },
      items: [],
      truncated: false,
      total: 0,
    });
    renderPanel({ initialCategory: "reads" });
    expect(
      await screen.findByRole("button", { name: /Reads 3/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, "reads", {
      limit: 25,
      offset: 0,
      order: "name",
    });
  });

  it("renders foreign keys under Other", async () => {
    const summary = callerSummary();
    summary.counts = { callers: 0, callees: 0, reads: 0, writes: 0, other: 1 };
    summary.items[0].relationship = "FOREIGN_KEY";
    summary.items[0].source.kind = "Table";
    summary.items[0].target.kind = "Table";
    getPlsqlDependencies.mockResolvedValue(summary);
    renderPanel({ initialCategory: "other" });
    expect(await screen.findByText("FOREIGN_KEY")).toBeInTheDocument();
    expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, "other", {
      limit: 25,
      offset: 0,
      order: "name",
    });
  });
});

describe("DependenciesPanel results table", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
  });

  it("renders a compact row: the other object, relationship, resolution and source", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    renderPanel();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Related object")).toBeInTheDocument();
    expect(within(table).getByText("Package")).toBeInTheDocument();
    expect(within(table).getByText("Relationship")).toBeInTheDocument();
    expect(within(table).getByText("Resolution")).toBeInTheDocument();
    expect(within(table).getByText("Evidence")).toBeInTheDocument();
    // Only the *other* object shows in the row; the analyzed object (DOCU_FIDE)
    // is already the page subject and doesn't need repeating in every row.
    expect(within(table).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(within(table).queryByText("DOCU_FIDE")).not.toBeInTheDocument();
    expect(within(table).getByText("CALLS")).toBeInTheDocument();
    expect(within(table).getByText("Resolved")).toBeInTheDocument();
    const name = within(table).getByText("CALC_IVA_MORA");
    expect(name).toHaveAttribute("title", "HR.FA_QFACT_CALC.CALC_IVA_MORA");
  });

  it("files the rows under collapsible package headers when grouping is on", async () => {
    const summary = callerSummary();
    const standalone = {
      ...summary.items[0],
      id: "edge://sample/CALLS/2",
      source: {
        id: "plsql://sample/HR/PROCEDURE/LONE",
        kind: "Procedure" as const,
        name: "LONE",
        schema: "HR",
        qualifiedName: "HR.LONE",
      },
    };
    summary.items = [...summary.items, standalone];
    summary.counts = { ...summary.counts, callers: 2 };
    getPlsqlDependencies.mockResolvedValue(summary);
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    const table = await screen.findByRole("table");
    expect(
      within(table).queryByRole("button", { name: /objects?$/ }),
    ).toBeNull();

    rerender(
      <DependenciesPanel
        object={object}
        groupByPackage
        onOpenEvidence={vi.fn()}
        onInspectObject={vi.fn()}
      />,
    );
    const grouped = await screen.findByRole("table");
    expect(getPlsqlDependencies).toHaveBeenLastCalledWith(
      object.id,
      "callers",
      { limit: 25, offset: 0, order: "package" },
    );
    const header = within(grouped).getByRole("button", {
      name: "FA_QFACT_CALC, 1 object",
    });
    expect(
      within(grouped).getByRole("button", { name: "No package, 1 object" }),
    ).toBeInTheDocument();
    expect(within(grouped).getByText("CALC_IVA_MORA")).toBeInTheDocument();

    await user.click(header);
    expect(within(grouped).queryByText("CALC_IVA_MORA")).toBeNull();
    expect(within(grouped).getByText("LONE")).toBeInTheDocument();
  });

  it("selects the dependency and shows it inline when its Evidence link is clicked", async () => {
    const onOpenEvidence = vi.fn();
    const callers = callerSummary();
    callers.items[0] = {
      ...callers.items[0],
      evidence: {
        sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
        startLine: 429,
        startColumn: 1,
        startOffset: 10,
        endOffset: 20,
      },
    };
    getPlsqlDependencies.mockResolvedValue(callers);
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
      },
      lines: ["  DOCU_FIDE(...);"],
      highlight: { startLine: 429, endLine: 429 },
    });
    const user = userEvent.setup();
    render(
      <DependenciesPanel
        object={object}
        groupByPackage={false}
        onOpenEvidence={onOpenEvidence}
        onInspectObject={vi.fn()}
      />,
    );
    const table = await screen.findByRole("table");
    await user.click(within(table).getByText("line 429"));

    // Shows inline in the Selected dependency split, without jumping tabs.
    expect(await screen.findByText("Selected dependency")).toBeInTheDocument();
    expect(await screen.findByText("Source evidence")).toBeInTheDocument();
    expect(onOpenEvidence).not.toHaveBeenCalled();
  });
});

describe("DependenciesPanel selected dependency", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
  });

  it("opens a selected-dependency split when a row is selected", async () => {
    const callers = callerSummary();
    callers.items[0] = {
      ...callers.items[0],
      evidence: {
        sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
        startLine: 429,
        startColumn: 1,
        startOffset: 10,
        endOffset: 20,
      },
    };
    getPlsqlDependencies.mockResolvedValue(callers);
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
      },
      lines: ["  DOCU_FIDE(...);"],
      highlight: { startLine: 429, endLine: 429 },
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByText("CALC_IVA_MORA"));

    expect(await screen.findByText("Selected dependency")).toBeInTheDocument();
    // The relationship pane shows just the line number; the full path lives
    // once, in the source evidence header, so the two panes don't repeat it.
    // (The compact table row above also shows "line 429", so there are two.)
    expect(screen.getAllByText("line 429").length).toBeGreaterThan(0);
    expect(await screen.findByText("Source evidence")).toBeInTheDocument();
    expect(await screen.findByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open full source" }),
    ).toBeInTheDocument();
    expect(getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/fa_qfact_calc.pkb",
      { startLine: 429, endLine: 429 },
    );
    await user.click(
      screen.getByRole("button", { name: "Close selected dependency" }),
    );
    expect(screen.queryByText("Selected dependency")).not.toBeInTheDocument();
  });

  it("shows one row for an object called on several lines and lets each line be inspected", async () => {
    const coordinate = (startLine: number) => ({
      sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
      path: "hr/fa_qfact_calc.pkb",
      startLine,
      startColumn: 1,
      startOffset: startLine * 10,
      endOffset: startLine * 10 + 5,
    });
    const callers = callerSummary();
    callers.items[0] = {
      ...callers.items[0],
      evidence: coordinate(1496),
      occurrences: [coordinate(1496), coordinate(1576)],
      occurrenceCount: 2,
    };
    getPlsqlDependencies.mockResolvedValue(callers);
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
      },
      lines: ["  DOCU_FIDE(...);"],
      highlight: { startLine: 1496, endLine: 1496 },
    });
    const user = userEvent.setup();
    renderPanel();

    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("CALC_IVA_MORA")).toHaveLength(1);
    expect(
      within(table).getByText("2 times · lines 1496, 1576"),
    ).toBeInTheDocument();

    await user.click(within(table).getByText("CALC_IVA_MORA"));
    const group = await screen.findByRole("group", { name: "Occurrences" });
    expect(
      within(group).getByRole("button", { name: "line 1496" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(getPlsqlFileSource).toHaveBeenCalledWith(
        "file://sample/hr/fa_qfact_calc.pkb",
        { startLine: 1496, endLine: 1496 },
      ),
    );

    await user.click(within(group).getByRole("button", { name: "line 1576" }));
    expect(
      within(group).getByRole("button", { name: "line 1576" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(getPlsqlFileSource).toHaveBeenCalledWith(
        "file://sample/hr/fa_qfact_calc.pkb",
        { startLine: 1576, endLine: 1576 },
      ),
    );
  });

  it("inspects the trail's node and relationship in place, without navigating", async () => {
    const callers = callerSummary();
    getPlsqlDependencies.mockResolvedValue(callers);
    const onInspectObject = vi.fn();
    const onInspectEdge = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onInspectObject, onInspectEdge });
    await user.click(await screen.findByText("CALC_IVA_MORA"));
    expect(await screen.findByText("Selected dependency")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "HR.FA_QFACT_CALC.CALC_IVA_MORA" }),
    );
    expect(onInspectObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
    // The panel is untouched by the inspect: still on Callers, split still open.
    expect(screen.getByRole("button", { name: /Callers 1/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Selected dependency")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CALLS" }));
    expect(onInspectEdge).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: "CALLS" }),
    );
  });

  it("provides View full path and Copy qualified name actions (open and analyze live in the Inspector)", async () => {
    const callers = callerSummary();
    getPlsqlDependencies.mockResolvedValue(callers);
    const onInspectPath = vi.fn();
    const user = userEvent.setup();
    // userEvent.setup() attaches its own clipboard stub to navigator; spy on
    // its writeText rather than replacing the whole navigator object.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderPanel({ onInspectPath });
    await user.click(await screen.findByText("CALC_IVA_MORA"));
    await screen.findByText("Selected dependency");

    expect(screen.queryByRole("button", { name: "Open object" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Analyze impact/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "View full path" }));
    expect(onInspectPath).toHaveBeenCalledWith(
      expect.objectContaining({ hopCount: 1 }),
    );

    await user.click(
      screen.getByRole("button", { name: "Copy qualified name" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("HR.FA_QFACT_CALC.CALC_IVA_MORA"),
    );
  });
});
