import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlImpactItem,
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
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

function ref(
  id: string,
  kind: PlsqlObjectReference["kind"],
  name: string,
  qualifiedName: string,
): PlsqlObjectReference {
  return { id, kind, name, schema: "HR", qualifiedName };
}

const docuFide = ref(
  "plsql://sample/HR/FUNCTION/DOCU_FIDE",
  "Function",
  "DOCU_FIDE",
  "HR.FA_QFACT_CALC.DOCU_FIDE",
);
const calcIvaMora = ref(
  "plsql://sample/HR/FUNCTION/CALC_IVA_MORA",
  "Function",
  "CALC_IVA_MORA",
  "HR.FA_QFACT_CALC.CALC_IVA_MORA",
);

function callsEdge(
  source: PlsqlObjectReference,
  target: PlsqlObjectReference,
  evidence: PlsqlPath["relationships"][number]["evidence"],
): PlsqlPath["relationships"][number] {
  return {
    id: `edge://sample/CALLS/${source.name}/${target.name}`,
    relationship: "CALLS",
    resolution: "EXACT",
    source,
    target,
    evidence,
  };
}

const result: PlsqlImpactResult = {
  object: docuFide,
  items: [
    {
      id: "impact://sample/d1",
      dependent: calcIvaMora,
      distance: 1,
      paths: [
        {
          id: "path://sample/p1",
          nodes: [calcIvaMora, docuFide],
          relationships: [
            callsEdge(calcIvaMora, docuFide, {
              sourceFileId: "file://sample/hr/fa_qfact_calc.pkb",
              path: "hr/fa_qfact_calc.pkb",
              startLine: 429,
              startColumn: 1,
              startOffset: 100,
              endOffset: 120,
            }),
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
const onInspectObject = vi.fn();
const onInspectEdge = vi.fn();
const onInspectPath = vi.fn();

function renderPanel() {
  return render(
    <ImpactReport
      objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
      onOpenEvidence={onOpenEvidence}
      onOpenObject={onOpenObject}
      onInspectObject={onInspectObject}
      onInspectEdge={onInspectEdge}
      onInspectPath={onInspectPath}
    />,
  );
}

async function selectFirstRow(name: string) {
  await userEvent.click(await screen.findByText(name));
}

describe("ImpactReport", () => {
  afterEach(() => {
    getPlsqlImpact.mockReset();
    onOpenEvidence.mockReset();
    onOpenObject.mockReset();
    onInspectObject.mockReset();
    onInspectEdge.mockReset();
    onInspectPath.mockReset();
    resetCytoscapeMock(cyMock);
  });

  it("renders blast radius cards and the affected objects table", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Direct")).toBeInTheDocument();
    expect(screen.getByText("Indirect dependents")).toBeInTheDocument();
    expect(screen.getAllByText("74").length).toBe(1);
    expect(screen.getByText("18")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Affected objects" });
    for (const header of ["Object", "Package", "Type", "Distance"]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    // Routine name and package are split into separate columns.
    expect(within(table).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(within(table).getByText("FA_QFACT_CALC")).toBeInTheDocument();
    expect(
      within(table).queryByText("HR.FA_QFACT_CALC.CALC_IVA_MORA"),
    ).toBeNull();
    expect(within(table).getByText("1 hop")).toBeInTheDocument();

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

  it("sorts affected objects by distance, package, then object name", async () => {
    const items: PlsqlImpactItem[] = [
      {
        id: "impact://sample/s2",
        dependent: ref("a", "Procedure", "BETA", "HR.PKG_B.BETA"),
        distance: 1,
        paths: [],
      },
      {
        id: "impact://sample/s1",
        dependent: ref("b", "Procedure", "ZETA", "HR.PKG_A.ZETA"),
        distance: 1,
        paths: [],
      },
      {
        id: "impact://sample/s4",
        dependent: ref("c", "Trigger", "FM_GORPA_UPD", "HR.FM_GORPA_UPD"),
        distance: 2,
        paths: [],
      },
      {
        id: "impact://sample/s3",
        dependent: ref("d", "Procedure", "ALPHA", "HR.PKG_A.ALPHA"),
        distance: 2,
        paths: [],
      },
    ];
    getPlsqlImpact.mockResolvedValue({ ...result, items });
    renderPanel();
    await screen.findByText("Blast radius");

    const table = screen.getByRole("table", { name: "Affected objects" });
    const rows = within(table).getAllByRole("row").slice(1);
    const names = rows.map(
      (row) => within(row).getAllByRole("cell")[0].textContent,
    );
    expect(names).toEqual(["ZETA", "BETA", "FM_GORPA_UPD", "ALPHA"]);
  });

  it("reveals the why-affected detail with a mini path and opens source", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");

    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("DOCU_FIDE")).toBeInTheDocument();
    expect(screen.getByText("hr/fa_qfact_calc.pkb:429")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "hr/fa_qfact_calc.pkb",
        startLine: 429,
      }),
    );
  });

  it("inspects a trail node and its relationship in place, without navigating", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");
    await screen.findByText("Why is this affected?");

    await userEvent.click(
      screen.getByRole("button", { name: "HR.FA_QFACT_CALC.DOCU_FIDE" }),
    );
    expect(onInspectObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "DOCU_FIDE" }),
    );
    expect(onOpenObject).not.toHaveBeenCalled();
    // Still on the same analysis: the detail stays open.
    expect(screen.getByText("Why is this affected?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "CALLS" }));
    expect(onInspectEdge).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: "CALLS" }),
    );
  });

  it("inspects the full path through onInspectPath", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");
    await screen.findByText("Why is this affected?");

    await userEvent.click(
      screen.getByRole("button", { name: "View full path" }),
    );
    expect(onInspectPath).toHaveBeenCalledWith(
      expect.objectContaining({ id: "path://sample/p1" }),
    );
  });

  it("focuses the selected object in the graph", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");
    await screen.findByText("Why is this affected?");

    await userEvent.click(
      screen.getByRole("button", { name: "Focus in graph" }),
    );
    expect(
      await screen.findByRole("img", { name: /Impact graph for/ }),
    ).toBeInTheDocument();

    const elements = addedElements(cyMock);
    const focused = elements
      .filter((element) => element.data.focused === "true")
      .map((element) => element.data.id);
    expect(focused).toEqual(["plsql://sample/HR/FUNCTION/CALC_IVA_MORA"]);
  });

  it("shows multiple paths and lets the user inspect them", async () => {
    const intermediate = ref(
      "plsql://sample/HR/FUNCTION/APPLY_IVA",
      "Function",
      "APPLY_IVA",
      "HR.FA_QFACT_CALC.APPLY_IVA",
    );
    const twoHopPath: PlsqlPath = {
      id: "path://sample/p2",
      nodes: [calcIvaMora, intermediate, docuFide],
      relationships: [
        callsEdge(calcIvaMora, intermediate, null),
        callsEdge(intermediate, docuFide, null),
      ],
      hopCount: 2,
    };
    getPlsqlImpact.mockResolvedValue({
      ...result,
      items: [
        {
          ...result.items[0],
          paths: [result.items[0].paths[0], twoHopPath],
        },
      ],
    });
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");

    expect(await screen.findByText("2 paths found")).toBeInTheDocument();
    // Shortest path is shown by default; the longer path is hidden.
    expect(screen.queryByText("APPLY_IVA")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Path"), ["1"]);
    expect(await screen.findByText("APPLY_IVA")).toBeInTheDocument();
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
    await user.click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
  });
});

describe("ImpactReport graph mode", () => {
  afterEach(() => {
    getPlsqlImpact.mockReset();
    onOpenEvidence.mockReset();
    onOpenObject.mockReset();
    onInspectObject.mockReset();
    onInspectEdge.mockReset();
    onInspectPath.mockReset();
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
      (element) =>
        element.data.id === "edge://sample/CALLS/CALC_IVA_MORA/DOCU_FIDE",
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
      nodeHandler({
        target: { id: () => "plsql://sample/HR/FUNCTION/CALC_IVA_MORA" },
      });
    });
    expect(onOpenObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CALC_IVA_MORA" }),
    );
  });
});
