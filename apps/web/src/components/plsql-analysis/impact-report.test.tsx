import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import type {
  PlsqlImpactItem,
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import { ImpactReport } from "./impact-report";

const getPlsqlImpact = vi.hoisted(() => vi.fn());
const getPlsqlImpactSummary = vi.hoisted(() => vi.fn());
const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  getPlsqlImpact,
  getPlsqlImpactSummary,
  getPlsqlFileSource,
}));

vi.mock("../auth-provider", () => ({
  useAuth: () => ({
    username: "tester",
    roles: new Set<string>(),
    logout: vi.fn(),
    config: { plsqlEnabled: true, plsqlMaxHops: 5 },
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
  nextCursor: null,
};

const summary = { direct: 1, indirect: 74, packages: 18, tablesModified: 0 };

const onOpenEvidence = vi.fn();
const onInspectObject = vi.fn();
const onInspectEdge = vi.fn();
const onInspectPath = vi.fn();

function panel(groupByPackage = false) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <ImpactReport
        objectId="plsql://sample/HR/FUNCTION/DOCU_FIDE"
        groupByPackage={groupByPackage}
        onOpenEvidence={onOpenEvidence}
        onInspectObject={onInspectObject}
        onInspectEdge={onInspectEdge}
        onInspectPath={onInspectPath}
      />
    </SWRConfig>
  );
}

function renderPanel(groupByPackage = false) {
  return render(panel(groupByPackage));
}

async function selectFirstRow(name: string) {
  await userEvent.click(await screen.findByText(name));
}

describe("ImpactReport", () => {
  beforeEach(() => {
    getPlsqlImpactSummary.mockResolvedValue({ object: docuFide, summary });
  });

  afterEach(() => {
    getPlsqlImpact.mockReset();
    getPlsqlImpactSummary.mockReset();
    onOpenEvidence.mockReset();
    onInspectObject.mockReset();
    onInspectEdge.mockReset();
    onInspectPath.mockReset();
  });

  it("asks the server for the selected blast radius card and pages through it", async () => {
    const user = userEvent.setup();
    const indirectDependent = ref(
      "plsql://sample/HR/PROCEDURE/RUN_BILLING",
      "Procedure",
      "RUN_BILLING",
      "HR.RUN_BILLING",
    );
    const indirectItem: PlsqlImpactItem = {
      id: "impact://sample/d2",
      dependent: indirectDependent,
      distance: 2,
      paths: [
        {
          id: "path://sample/p2",
          nodes: [indirectDependent, calcIvaMora, docuFide],
          relationships: [
            callsEdge(indirectDependent, calcIvaMora, null),
            callsEdge(calcIvaMora, docuFide, null),
          ],
          hopCount: 2,
        },
      ],
    };
    getPlsqlImpact.mockImplementation(
      async (_id: string, options: { scope?: string }) => {
        if (options.scope === "indirect")
          return { ...result, items: [indirectItem], count: 1 };
        return { ...result, items: result.items, count: 2 };
      },
    );
    renderPanel();
    const table = await screen.findByRole("table", {
      name: "Affected objects",
    });
    expect(within(table).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      expect.objectContaining({ scope: "all" }),
    );

    await user.click(
      screen.getByRole("button", { name: /Indirect dependents/ }),
    );
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ scope: "indirect", offset: 0 }),
      ),
    );
    const filtered = await screen.findByRole("table", {
      name: "Affected objects",
    });
    expect(within(filtered).getByText("RUN_BILLING")).toBeInTheDocument();
    expect(within(filtered).queryByText("CALC_IVA_MORA")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Indirect dependents/ }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByRole("button", { name: /Indirect dependents/ }),
    );
    // "All" was already fetched, so it is served from the page cache.
    expect(await screen.findByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Indirect dependents/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("groups the affected objects by package and collapses a package", async () => {
    const user = userEvent.setup();
    const itemFor = (dependent: PlsqlObjectReference, id: string) => ({
      ...result.items[0],
      id,
      dependent,
    });
    const sibling = ref(
      "plsql://sample/HR/FUNCTION/CALC_OTRO",
      "Function",
      "CALC_OTRO",
      "HR.FA_QFACT_CALC.CALC_OTRO",
    );
    const standalone = ref(
      "plsql://sample/HR/PROCEDURE/LONE",
      "Procedure",
      "LONE",
      "HR.LONE",
    );
    getPlsqlImpact.mockResolvedValue({
      ...result,
      items: [
        itemFor(calcIvaMora, "impact://sample/a"),
        itemFor(sibling, "impact://sample/b"),
        itemFor(standalone, "impact://sample/c"),
      ],
      count: 3,
    });
    const { rerender } = renderPanel();
    const table = await screen.findByRole("table", {
      name: "Affected objects",
    });
    // Flat list by default: no group headers.
    expect(
      within(table).queryByRole("button", { name: /objects?$/ }),
    ).toBeNull();

    // Grouping re-reads the list in package order.
    rerender(panel(true));
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ order: "package", offset: 0 }),
      ),
    );
    const grouped = await screen.findByRole("table", {
      name: "Affected objects",
    });
    const header = within(grouped).getByRole("button", {
      name: "FA_QFACT_CALC, 2 objects",
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      within(grouped).getByRole("button", { name: "No package, 1 object" }),
    ).toBeInTheDocument();
    expect(within(grouped).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(within(grouped).getByText("LONE")).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(grouped).queryByText("CALC_IVA_MORA")).toBeNull();
    expect(within(grouped).queryByText("CALC_OTRO")).toBeNull();
    expect(within(grouped).getByText("LONE")).toBeInTheDocument();

    await user.click(header);
    expect(within(grouped).getByText("CALC_IVA_MORA")).toBeInTheDocument();

    rerender(panel(false));
    const flat = await screen.findByRole("table", {
      name: "Affected objects",
    });
    expect(
      within(flat).queryByRole("button", { name: /objects?$/ }),
    ).toBeNull();
    expect(within(flat).getByText("LONE")).toBeInTheDocument();
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
        limit: 25,
        direction: "upstream",
        depth: 5,
        relationship: undefined,
        directOnly: false,
        writesOnly: false,
        offset: 0,
        scope: "all",
        order: "name",
      },
    );
    // The totals come from their own service, with the same traversal filters.
    expect(getPlsqlImpactSummary).toHaveBeenCalledWith(
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

  it("keeps the rows usable when the totals fail, and retries them on their own", async () => {
    const user = userEvent.setup();
    getPlsqlImpact.mockResolvedValue(result);
    getPlsqlImpactSummary
      .mockRejectedValueOnce({ code: "analysis_unavailable" })
      .mockResolvedValue({ object: docuFide, summary });
    renderPanel();

    const table = await screen.findByRole("table", {
      name: "Affected objects",
    });
    expect(within(table).getByText("CALC_IVA_MORA")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.getAllByText("—").length).toBe(4);

    await user.click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    expect(await screen.findByText("74")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(getPlsqlImpact).toHaveBeenCalledTimes(1);
  });

  it("shows the totals as soon as they arrive, independent of the rows", async () => {
    let resolveSummary!: (value: unknown) => void;
    getPlsqlImpact.mockResolvedValue(result);
    getPlsqlImpactSummary.mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );
    renderPanel();
    await screen.findByRole("table", { name: "Affected objects" });
    expect(screen.getAllByText("—").length).toBe(4);

    resolveSummary({ object: docuFide, summary });
    expect(await screen.findByText("74")).toBeInTheDocument();
  });

  it("lists affected objects in the server's alphabetical order, whatever their distance", async () => {
    const item = (
      id: string,
      name: string,
      qualified: string,
      distance: number,
    ): PlsqlImpactItem => ({
      id: `impact://sample/${id}`,
      dependent: ref(id, "Procedure", name, qualified),
      distance,
      paths: [],
    });
    getPlsqlImpact.mockResolvedValue({
      ...result,
      items: [
        item("a", "ALPHA", "HR.PKG_A.ALPHA", 2),
        item("b", "BETA", "HR.PKG_B.BETA", 1),
        item("c", "FM_GORPA_UPD", "HR.FM_GORPA_UPD", 2),
        item("d", "ZETA", "HR.PKG_A.ZETA", 1),
      ],
    });
    renderPanel();
    await screen.findByText("Blast radius");

    const table = screen.getByRole("table", { name: "Affected objects" });
    const rows = within(table).getAllByRole("row").slice(1);
    const names = rows.map(
      (row) => within(row).getAllByRole("cell")[0].textContent,
    );
    expect(names).toEqual(["ALPHA", "BETA", "FM_GORPA_UPD", "ZETA"]);
  });

  it("navigates impact pages by number, previous and next", async () => {
    const named = (name: string): PlsqlImpactItem => ({
      ...result.items[0],
      id: `impact://sample/${name}`,
      dependent: ref(
        `plsql://sample/HR/FUNCTION/${name}`,
        "Function",
        name,
        `HR.${name}`,
      ),
    });
    getPlsqlImpact.mockImplementation(
      async (_id: string, options: { offset?: number }) => ({
        ...result,
        items: [named(`PAGE_${(options.offset ?? 0) / 25 + 1}`)],
        count: 60,
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText("PAGE_1")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("PAGE_2")).toBeInTheDocument();
    expect(screen.queryByText("PAGE_1")).toBeNull();
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      expect.objectContaining({ limit: 25, offset: 25 }),
    );

    await user.click(screen.getByRole("button", { name: "Go to page 3" }));
    expect(await screen.findByText("PAGE_3")).toBeInTheDocument();
    expect(screen.getByText("Showing 51–60 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("keeps the shown page and retries only the page that failed", async () => {
    let failNext = true;
    getPlsqlImpact.mockImplementation(
      async (_id: string, options: { offset?: number }) => {
        if (!options.offset) return { ...result, count: 40 };
        if (failNext) throw { code: "analysis_unavailable" };
        return { ...result, items: [], count: 40 };
      },
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Next" }));
    expect(
      await screen.findByText("Could not load this page."),
    ).toBeInTheDocument();
    expect(screen.getByText("CALC_IVA_MORA")).toBeInTheDocument();

    failNext = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("Could not load this page.")).toBeNull(),
    );
    expect(screen.getByText("Showing 26–40 of 40")).toBeInTheDocument();
  });

  it("returns to the first page and ignores a stale one when filters change", async () => {
    let resolvePage2!: (value: PlsqlImpactResult) => void;
    getPlsqlImpact.mockImplementation(
      async (_id: string, options: { direction?: string; offset?: number }) => {
        if (options.direction === "downstream")
          return { ...result, items: [], count: 0 };
        if (options.offset)
          return new Promise<PlsqlImpactResult>((resolve) => {
            resolvePage2 = resolve;
          });
        return { ...result, count: 40 };
      },
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.selectOptions(screen.getByLabelText("Direction"), "downstream");
    expect(
      await screen.findByText("No impacted dependents"),
    ).toBeInTheDocument();
    resolvePage2(result);
    await waitFor(() =>
      expect(screen.getByText("No impacted dependents")).toBeInTheDocument(),
    );
    expect(getPlsqlImpact).toHaveBeenLastCalledWith(
      "plsql://sample/HR/FUNCTION/DOCU_FIDE",
      expect.objectContaining({ direction: "downstream", offset: 0 }),
    );
  });

  it("reveals the why-affected detail with a mini path and opens source", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    getPlsqlFileSource.mockResolvedValue({
      file: {
        fileId: "file://sample/hr/fa_qfact_calc.pkb",
        path: "hr/fa_qfact_calc.pkb",
      },
      lines: ["  DOCU_FIDE(...);"],
      highlight: { startLine: 429, endLine: 429 },
    });
    renderPanel();
    await selectFirstRow("CALC_IVA_MORA");

    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();
    expect(screen.getByText("DOCU_FIDE")).toBeInTheDocument();
    // The relationship pane shows just the line number; the full path lives
    // once, in the source evidence header. (The affected-objects table's
    // Evidence column also shows "line 429", so there are two.)
    expect(screen.getAllByText("line 429").length).toBeGreaterThan(0);
    expect(await screen.findByText("Source evidence")).toBeInTheDocument();
    expect(await screen.findByText("hr/fa_qfact_calc.pkb")).toBeInTheDocument();

    // Open / analyze actions live in the Inspector, not in this panel.
    expect(screen.queryByRole("button", { name: "Open object" })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Open full source" }),
    );
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "hr/fa_qfact_calc.pkb",
        startLine: 429,
      }),
    );
  });

  it("shows an Evidence column in the affected objects table and closes the detail", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    renderPanel();

    const table = await screen.findByRole("table", {
      name: "Affected objects",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Evidence" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("line 429")).toBeInTheDocument();

    await selectFirstRow("CALC_IVA_MORA");
    expect(
      await screen.findByText("Why is this affected?"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Close why CALC_IVA_MORA is affected",
      }),
    );
    expect(screen.queryByText("Why is this affected?")).not.toBeInTheDocument();
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

  it.each(["TRIGGERS", "FOREIGN_KEY"])(
    "offers %s as a selectable relationship filter",
    async (relationship) => {
      getPlsqlImpact.mockResolvedValue(result);
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText("Blast radius");
      await user.selectOptions(
        screen.getByLabelText("Relationship"),
        relationship,
      );
      await waitFor(() =>
        expect(getPlsqlImpact).toHaveBeenLastCalledWith(
          "plsql://sample/HR/FUNCTION/DOCU_FIDE",
          expect.objectContaining({ relationship }),
        ),
      );
    },
  );

  it("passes depth and checkbox filters to the backend", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");
    const depthField = screen.getByLabelText("Depth");
    await user.clear(depthField);
    await user.type(depthField, "2");
    await user.tab();
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

  it("lets depth be typed up to the deployment's configured max, clamping anything higher", async () => {
    getPlsqlImpact.mockResolvedValue(result);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Blast radius");

    // The fixture's mocked auth config sets plsqlMaxHops to 5.
    expect(screen.getByText("max 5")).toBeInTheDocument();
    const depthField = screen.getByLabelText("Depth");
    expect(depthField).toHaveAttribute("max", "5");

    await user.clear(depthField);
    await user.type(depthField, "50");
    await user.tab();
    await waitFor(() => expect(depthField).toHaveValue(5));
    await waitFor(() =>
      expect(getPlsqlImpact).toHaveBeenLastCalledWith(
        "plsql://sample/HR/FUNCTION/DOCU_FIDE",
        expect.objectContaining({ depth: 5 }),
      ),
    );
  });

  it("shows the empty state", async () => {
    getPlsqlImpact.mockResolvedValue({
      ...result,
      items: [],
      truncated: false,
      count: 0,
    });
    renderPanel();
    expect(
      await screen.findByText("No impacted dependents"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
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
