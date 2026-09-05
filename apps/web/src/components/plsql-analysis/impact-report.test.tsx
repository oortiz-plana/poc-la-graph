import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlImpactResult } from "@/lib/contracts";
import { addedElements, resetCytoscapeMock } from "./cytoscape-mock";
import { ImpactReport } from "./impact-report";

const getPlsqlImpact = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlImpact }));

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

const result: PlsqlImpactResult = {
  object: {
    id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
    kind: "Function",
    name: "DOCU_FIDE",
    schema: "HR",
    qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
  },
  items: [
    {
      id: "impact://sample/d1",
      dependent: {
        id: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
        kind: "Function",
        name: "CALC_IVA_MORA",
        schema: "HR",
        qualifiedName: "HR.FA_QFACT_CALC.CALC_IVA_MORA",
      },
      distance: 1,
      paths: [
        {
          id: "path://sample/p1",
          nodes: [
            {
              id: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
              kind: "Function",
              name: "CALC_IVA_MORA",
              schema: "HR",
              qualifiedName: "HR.FA_QFACT_CALC.CALC_IVA_MORA",
            },
            {
              id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
              kind: "Function",
              name: "DOCU_FIDE",
              schema: "HR",
              qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
            },
          ],
          relationships: [
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
                id: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
                kind: "Function",
                name: "DOCU_FIDE",
                schema: "HR",
                qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
              },
              evidence: {
                sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
                path: "hr/fa_qfact_calc.pkb",
                startLine: 429,
                startColumn: 1,
                startOffset: 100,
                endOffset: 120,
              },
            },
          ],
          hopCount: 1,
        },
      ],
    },
  ],
  truncated: false,
  count: 1,
  summary: { direct: 1, indirect: 74, packages: 18, tablesModified: 0 },
};

const onOpenEvidence = vi.fn();
const onOpenObject = vi.fn();

function renderPanel() {
  return render(
    <ImpactReport
      objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
      onOpenEvidence={onOpenEvidence}
      onOpenObject={onOpenObject}
    />,
  );
}

describe("ImpactReport", () => {
  afterEach(() => {
    getPlsqlImpact.mockReset();
    onOpenEvidence.mockReset();
    onOpenObject.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("renders blast radius cards and the affected objects list", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Direct")).toBeInTheDocument();
    expect(screen.getByText("Indirect dependents")).toBeInTheDocument();
    expect(screen.getAllByText("74").length).toBe(1);
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("HR.FA_QFACT_CALC.CALC_IVA_MORA")).toBeInTheDocument();
    expect(screen.getByText("1 hop")).toBeInTheDocument();
    expect(getPlsqlImpact).toHaveBeenCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      {
        direction: "upstream",
        depth: 5,
        relationship: undefined,
        directOnly: false,
        writesOnly: false,
      },
    );
  });

  it("reveals the explaining path with progressive disclosure", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole("button", { name: /CALC_IVA_MORA/ }),
    );
    expect(await screen.findByText("Why is this affected?")).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes("DOCU_FIDE"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("hr/fa_qfact_calc.pkb:429")).toBeInTheDocument();
  });

  it("refetches when the direction filter changes", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    await user.selectOptions(screen.getByLabelText("Direction"), "downstream");
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ direction: "downstream" }),
      ),
    );
  });

  it("passes depth and checkbox filters to the backend", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    await user.selectOptions(screen.getByLabelText("Depth"), "2");
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ depth: 2 }),
      ),
    );
    await user.click(screen.getByLabelText("Direct only"));
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ directOnly: true, depth: undefined }),
      ),
    );
    await user.click(screen.getByLabelText("Writes only"));
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ writesOnly: true }),
      ),
    );
  });

  it("shows the empty state and truncation flag", async () => {
    getPlsqlImpact.mockResolvedValue({
      ...result,
      items: [],
      truncated: true,
      count: 0,
      summary: { direct: 0, indirect: 0, packages: 0, tablesModified: 0 },
    });
    renderPanel();
    expect(
      await screen.findByText("No impacted dependents"),
    ).toBeInTheDocument();
    expect(screen.getByText("Results truncated")).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    getPlsqlImpact
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await user.click(screen.getByRole("button", { name: "Retry analysis query" }));
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
  });
});

describe("ImpactReport graph mode", () => {
  afterEach(() => {
    getPlsqlImpact.mockReset();
    onOpenEvidence.mockReset();
    onOpenObject.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("renders the changed object, affected objects, and path edges", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    await user.click(screen.getByRole("button", { name: "Graph" }));

    expect(
      await screen.findByRole("img", { name: /Impact graph for/ }),
    ).toBeInTheDocument();
    const elements = addedElements(cyMock);
    const ids = elements.map((element) => element.data.id);
    expect(ids).toContain("plsql://sample/HR/FUNCTION/DOCU_FIDE");
    expect(ids).toContain("plsql://sample/HR/FUNCTION/CALC_IVA_MORA");
    const edge = elements.find(
      (element) => element.data.id === "edge://sample/CALLS/1",
    );
    expect(edge?.data).toMatchObject({
      source: "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
      target: "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      label: "CALLS",
    });
  });

  it("collapses routines into a package node and drills down on tap", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    await user.click(screen.getByRole("button", { name: "Graph" }));
    await user.click(screen.getByLabelText("Group by package"));

    await waitFor(() => {
      const elements = addedElements(cyMock);
      expect(elements.map((element) => element.data.id)).toEqual([
        "pkg://HR.FA_QFACT_CALC",
      ]);
    });

    const nodeHandler = cyMock.on.mock.calls.find(
      (call) => call[1] === "node",
    )![2] as (event: { target: { id: () => string } }) => void;
    act(() => {
      nodeHandler({ target: { id: () => "pkg://HR.FA_QFACT_CALC" } });
    });

    await waitFor(() => {
      const elements = addedElements(cyMock);
      const ids = elements.map((element) => element.data.id);
      expect(ids).toContain("plsql://sample/HR/FUNCTION/DOCU_FIDE");
      expect(ids).toContain("plsql://sample/HR/FUNCTION/CALC_IVA_MORA");
    });
  });

  it("reports member node taps through onOpenObject", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    await user.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => expect(cyMock.on).toHaveBeenCalled());
    const nodeHandler = cyMock.on.mock.calls.find(
      (call) => call[1] === "node",
    )![2] as (event: { target: { id: () => string } }) => void;
    act(() => {
      nodeHandler({ target: { id: () => "plsql://sample/HR/FUNCTION/CALC_IVA_MORA" } });
    });
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
  });
});
