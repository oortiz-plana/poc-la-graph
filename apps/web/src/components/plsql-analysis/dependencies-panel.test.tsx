import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencySummary,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import { addedElements, resetCytoscapeMock } from "./cytoscape-mock";
import { DependenciesPanel } from "./dependencies-panel";

const getPlsqlDependencies = vi.hoisted(() => vi.fn());
const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlDependencies, getPlsqlFileSource }));

const cyMock = vi.hoisted(() => ({
  on: vi.fn(),
  destroy: vi.fn(),
  elements: vi.fn(() => ({ remove: vi.fn() })),
  add: vi.fn(),
  layout: vi.fn(() => ({ run: vi.fn(), one: vi.fn() })),
  pan: vi.fn(() => ({ x: 10, y: 20 })),
  zoom: vi.fn(() => 1.5),
}));
vi.mock("cytoscape", () => ({ default: vi.fn(() => cyMock) }));

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

const emptySummary: PlsqlDependencySummary = {
  counts: { callers: 1, callees: 0, reads: 0, writes: 0, other: 0 },
  items: [],
  truncated: false,
  total: 0,
};

function renderPanel(
  overrides: {
    onOpenObject?: (reference: PlsqlObjectReference) => void;
    onInspectObject?: (reference: PlsqlObjectReference) => void;
    onInspectEdge?: (edge: PlsqlDependency) => void;
    onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
    onInspectPath?: (path: PlsqlPath) => void;
    initialCategory?: "callers" | "callees" | "reads" | "writes" | "other";
  } = {},
) {
  return render(
    <DependenciesPanel
      object={object}
      initialCategory={overrides.initialCategory}
      onOpenEvidence={vi.fn()}
      onOpenObject={overrides.onOpenObject ?? vi.fn()}
      onInspectObject={overrides.onInspectObject ?? vi.fn()}
      onInspectEdge={overrides.onInspectEdge}
      onAnalyzeObject={overrides.onAnalyzeObject}
      onInspectPath={overrides.onInspectPath}
    />,
  );
}

describe("DependenciesPanel graph mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("starts in list mode with category chips", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    renderPanel();
    expect(
      await screen.findByRole("button", { name: /Callers 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /One level/ }),
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
    expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, "reads");
  });

  it("shows only the focused object when graph mode opens without expansions", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    expect(
      await screen.findByRole("img", { name: /Dependency graph for/ }),
    ).toBeInTheDocument();
    const elements = addedElements(cyMock);
    expect(elements).toHaveLength(1);
    expect(elements[0].data).toMatchObject({
      id: object.id,
      focused: "true",
    });
    expect(screen.getByText(/Expand a category/)).toBeInTheDocument();
  });

  it("expands a category explicitly and draws its edges", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(await screen.findByRole("button", { name: /Callers 1/ }));
    await waitFor(() =>
      expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, "callers"),
    );
    await waitFor(() => {
      const elements = addedElements(cyMock);
      expect(elements).toHaveLength(3);
      const edge = elements[2].data;
      expect(edge).toMatchObject({
        id: "edge://sample/CALLS/1",
        source: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
        target: object.id,
        label: "CALLS",
      });
    });
  });

  it("expands every category with One level", async () => {
    getPlsqlDependencies.mockResolvedValue(emptySummary);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(screen.getByRole("button", { name: /One level/ }));
    await waitFor(() => expect(getPlsqlDependencies).toHaveBeenCalledTimes(5));
    for (const category of ["callers", "callees", "reads", "writes", "other"]) {
      expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, category);
    }
  });

  it("reports node taps through onOpenObject", async () => {
    const onOpenObject = vi.fn();
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    const user = userEvent.setup();
    renderPanel({ onOpenObject });
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(await screen.findByRole("button", { name: /Callers 1/ }));
    await waitFor(() => expect(cyMock.on).toHaveBeenCalled());
    const nodeHandler = cyMock.on.mock.calls.find(
      (call) => call[1] === "node",
    )![2] as (event: { target: { id: () => string } }) => void;
    nodeHandler({
      target: { id: () => "plsql://sample/HR/FUNCTION/CALC_IVA_MORA" },
    });
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
  });

  it("shows the shared error panel when a graph fetch fails", async () => {
    getPlsqlDependencies.mockResolvedValueOnce(emptySummary);
    getPlsqlDependencies.mockRejectedValueOnce({
      code: "analysis_unavailable",
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(screen.getByRole("button", { name: /Callees/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
  });
});

describe("DependenciesPanel results table", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("renders a compact row: the other object, relationship, resolution and source", async () => {
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    renderPanel();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Target")).toBeInTheDocument();
    expect(within(table).getByText("Relationship")).toBeInTheDocument();
    expect(within(table).getByText("Resolution")).toBeInTheDocument();
    expect(within(table).getByText("Source")).toBeInTheDocument();
    // Only the *other* object shows in the row; the analyzed object (DOCU_FIDE)
    // is already the page subject and doesn't need repeating in every row.
    expect(within(table).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(within(table).queryByText("DOCU_FIDE")).not.toBeInTheDocument();
    expect(within(table).getByText("CALLS")).toBeInTheDocument();
    expect(within(table).getByText("Resolved")).toBeInTheDocument();
    const name = within(table).getByText("CALC_IVA_MORA");
    expect(name).toHaveAttribute("title", "HR.FA_QFACT_CALC.CALC_IVA_MORA");
  });
});

describe("DependenciesPanel selected dependency", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
    resetCytoscapeMock(cyMock);
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
    expect(
      screen.getAllByText("hr/fa_qfact_calc.pkb:429").length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/fa_qfact_calc.pkb",
      { startLine: 429, endLine: 429 },
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Selected dependency")).not.toBeInTheDocument();
  });

  it("inspects the trail's node and relationship in place, without navigating", async () => {
    const callers = callerSummary();
    getPlsqlDependencies.mockResolvedValue(callers);
    const onOpenObject = vi.fn();
    const onInspectObject = vi.fn();
    const onInspectEdge = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onOpenObject, onInspectObject, onInspectEdge });
    await user.click(await screen.findByText("CALC_IVA_MORA"));
    expect(await screen.findByText("Selected dependency")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "HR.FA_QFACT_CALC.CALC_IVA_MORA" }),
    );
    expect(onInspectObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
    expect(onOpenObject).not.toHaveBeenCalled();
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

  it("opens the split view from a graph edge tap", async () => {
    const callers = callerSummary();
    callers.items[0] = { ...callers.items[0], evidence: null };
    getPlsqlDependencies.mockResolvedValue(callers);
    getPlsqlFileSource.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(await screen.findByRole("button", { name: /Callers 1/ }));
    await waitFor(() => expect(cyMock.on).toHaveBeenCalled());
    const edgeHandler = cyMock.on.mock.calls.find(
      (call) => call[1] === "edge",
    )![2] as (event: { target: { id: () => string } }) => void;
    act(() => {
      edgeHandler({ target: { id: () => "edge://sample/CALLS/1" } });
    });
    expect(await screen.findByText("Selected dependency")).toBeInTheDocument();
    expect(
      screen.getByText("No source evidence available for this dependency."),
    ).toBeInTheDocument();
  });

  it("provides Open object, Analyze impact, View full path and Copy qualified name actions", async () => {
    const callers = callerSummary();
    getPlsqlDependencies.mockResolvedValue(callers);
    const onOpenObject = vi.fn();
    const onAnalyzeObject = vi.fn();
    const onInspectPath = vi.fn();
    const user = userEvent.setup();
    // userEvent.setup() attaches its own clipboard stub to navigator; spy on
    // its writeText rather than replacing the whole navigator object.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderPanel({ onOpenObject, onAnalyzeObject, onInspectPath });
    await user.click(await screen.findByText("CALC_IVA_MORA"));
    await screen.findByText("Selected dependency");

    await user.click(screen.getByRole("button", { name: "Open object" }));
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );

    await user.click(screen.getByRole("button", { name: "Analyze impact" }));
    expect(onAnalyzeObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );

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
