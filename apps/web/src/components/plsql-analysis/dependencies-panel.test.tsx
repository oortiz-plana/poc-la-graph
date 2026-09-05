import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlDependencySummary, PlsqlObject } from "@/lib/contracts";
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

function renderPanel(onOpenObject = vi.fn()) {
  return render(
    <DependenciesPanel
      object={object}
      onOpenEvidence={vi.fn()}
      onOpenObject={onOpenObject}
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
    await user.click(
      await screen.findByRole("button", { name: /Callers 1/ }),
    );
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
    await waitFor(() =>
      expect(getPlsqlDependencies).toHaveBeenCalledTimes(5),
    );
    for (const category of ["callers", "callees", "reads", "writes", "other"]) {
      expect(getPlsqlDependencies).toHaveBeenCalledWith(object.id, category);
    }
  });

  it("reports node taps through onOpenObject", async () => {
    const onOpenObject = vi.fn();
    getPlsqlDependencies.mockResolvedValue(callerSummary());
    const user = userEvent.setup();
    renderPanel(onOpenObject);
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(await screen.findByRole("button", { name: /Callers 1/ }));
    await waitFor(() => expect(cyMock.on).toHaveBeenCalled());
    const nodeHandler = cyMock.on.mock.calls.find((call) => call[1] === "node")![2] as (
      event: { target: { id: () => string } },
    ) => void;
    nodeHandler({ target: { id: () => "plsql://sample/HR/FUNCTION/CALC_IVA_MORA" } });
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
  });

  it("shows the shared error panel when a graph fetch fails", async () => {
    getPlsqlDependencies.mockResolvedValueOnce(emptySummary);
    getPlsqlDependencies.mockRejectedValueOnce({ code: "analysis_unavailable" });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Graph" }));
    await user.click(screen.getByRole("button", { name: /Callees/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
  });
});

describe("DependenciesPanel split view", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPlsqlDependencies.mockReset();
    getPlsqlFileSource.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("opens a dependency-source split when a row is selected", async () => {
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
      file: { fileId: "file://sample/hr/fa_qfact_calc.pkb", path: "hr/fa_qfact_calc.pkb" },
      lines: ["  DOCU_FIDE(...);"],
      highlight: { startLine: 429, endLine: 429 },
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole("button", {
        name: /Show dependency details for/,
      }),
    );

    expect(await screen.findByText("Dependency")).toBeInTheDocument();
    expect(
      screen.getAllByText("hr/fa_qfact_calc.pkb:429").length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();
    expect(getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/fa_qfact_calc.pkb",
      { startLine: 429, endLine: 429 },
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Dependency")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Dependency")).toBeInTheDocument();
    expect(
      screen.getByText("No source evidence for this dependency"),
    ).toBeInTheDocument();
  });
});
