import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import { DependencyPathsSection } from "./dependency-paths";

const searchPlsqlObjects = vi.hoisted(() => vi.fn());
const findPlsqlPaths = vi.hoisted(() => vi.fn());
const getPlsqlFileSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  searchPlsqlObjects,
  findPlsqlPaths,
  getPlsqlFileSource,
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

const runPayroll: PlsqlObject = {
  id: "plsql://sample/HR/PROCEDURE/RUN_PAYROLL",
  kind: "Procedure",
  name: "RUN_PAYROLL",
  schema: "HR",
  qualifiedName: "HR.PKG_PAYROLL.RUN_PAYROLL",
  projectId: "sample",
  owner: "PKG_PAYROLL",
  signature: null,
  returnType: null,
  declaration: null,
};

const trigger = ref(
  "plsql://sample/HR/TRIGGER/FM_GORPA_UPD",
  "Trigger",
  "FM_GORPA_UPD",
  "VU_SFI.FM_GORPA_UPD",
);
const reversa = ref(
  "plsql://sample/HR/PROCEDURE/REVERSA_CONTAB_TESOR",
  "Procedure",
  "REVERSA_CONTAB_TESOR",
  "VU_SFI.FM_QCONTABILIDAD_FMI.REVERSA_CONTAB_TESOR",
);
const insertar = ref(
  "plsql://sample/HR/PROCEDURE/INSERTAR_SC_TANUL",
  "Procedure",
  "INSERTAR_SC_TANUL",
  "VU_SFI.FM_QCONTABILIDAD_FMI.INSERTAR_SC_TANUL",
);

const twoHopPath: PlsqlPath = {
  id: "path://sample/p1",
  nodes: [trigger, reversa, insertar],
  relationships: [
    {
      id: "edge://sample/CALLS/1",
      relationship: "CALLS",
      resolution: "EXACT",
      source: trigger,
      target: reversa,
      evidence: {
        sourceFileId: "file://sample/triggers/fm_gorpa_upd.sql",
        path: "Triggers/FM_GORPA_UPD.sql",
        startLine: 66,
        startColumn: 1,
        startOffset: 10,
        endOffset: 20,
      },
    },
    {
      id: "edge://sample/CALLS/2",
      relationship: "CALLS",
      resolution: "EXACT",
      source: reversa,
      target: insertar,
      evidence: {
        sourceFileId: "file://sample/packages/fm_qcontabilidad_fmi.pkb",
        path: "Packages/FM_QCONTABILIDAD_FMI.sql",
        startLine: 2366,
        startColumn: 1,
        startOffset: 10,
        endOffset: 20,
      },
    },
  ],
  hopCount: 2,
};

const onOpenEvidence = vi.fn();

function fileSource(fileId: string, path: string, line: number) {
  return {
    file: { fileId, path },
    lines: ["-- line content"],
    highlight: { startLine: line, endLine: line },
  };
}

describe("DependencyPathsSection selected path", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function traceAndSelect(user: ReturnType<typeof userEvent.setup>) {
    render(
      <DependencyPathsSection
        onInspectObject={vi.fn()}
        onOpenEvidence={onOpenEvidence}
        onInspectPath={vi.fn()}
        onInspectEdge={vi.fn()}
        onOpenObject={vi.fn()}
        onAnalyzeObject={vi.fn()}
      />,
    );
    searchPlsqlObjects.mockResolvedValueOnce({
      items: [trigger],
      truncated: false,
      count: 1,
    });
    await user.type(screen.getByLabelText("From object"), "gorpa");
    await user.click(
      await screen.findByRole("option", { name: /FM_GORPA_UPD/ }),
    );
    searchPlsqlObjects.mockResolvedValueOnce({
      items: [runPayroll],
      truncated: false,
      count: 1,
    });
    await user.type(screen.getByLabelText("To object"), "reversa");
    await user.click(
      await screen.findByRole("option", { name: /RUN_PAYROLL/ }),
    );
    findPlsqlPaths.mockResolvedValue({
      items: [twoHopPath],
      truncated: false,
      count: 1,
    });
    await user.click(screen.getByRole("button", { name: "Find paths" }));
    await screen.findByText("2 hops");
    await user.click(
      screen.getByText(
        "FM_GORPA_UPD → REVERSA_CONTAB_TESOR → INSERTAR_SC_TANUL",
      ),
    );
    await screen.findByText("Selected path");
  }

  it("shows the final hop's evidence by default and opens full source on request", async () => {
    const user = userEvent.setup();
    getPlsqlFileSource.mockResolvedValue(
      fileSource(
        "file://sample/packages/fm_qcontabilidad_fmi.pkb",
        "Packages/FM_QCONTABILIDAD_FMI.sql",
        2366,
      ),
    );
    await traceAndSelect(user);

    expect(await screen.findByText("Source evidence")).toBeInTheDocument();
    expect(
      await screen.findByText("Packages/FM_QCONTABILIDAD_FMI.sql"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open full source" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "Packages/FM_QCONTABILIDAD_FMI.sql",
        startLine: 2366,
      }),
    );
  });

  it("selects an earlier hop's evidence in place when its trail link is clicked, without navigating", async () => {
    const user = userEvent.setup();
    getPlsqlFileSource.mockImplementation((fileId: string) =>
      Promise.resolve(
        fileId === "file://sample/triggers/fm_gorpa_upd.sql"
          ? fileSource(fileId, "Triggers/FM_GORPA_UPD.sql", 66)
          : fileSource(fileId, "Packages/FM_QCONTABILIDAD_FMI.sql", 2366),
      ),
    );
    await traceAndSelect(user);
    // Final hop's evidence shown by default.
    await screen.findByText("Packages/FM_QCONTABILIDAD_FMI.sql");

    onOpenEvidence.mockClear();
    await user.click(screen.getByText("Triggers/FM_GORPA_UPD.sql:66"));

    // Still on the same view, no navigation triggered by the hop link itself
    // — the panel switches to the clicked hop's evidence instead.
    expect(onOpenEvidence).not.toHaveBeenCalled();
    expect(screen.getByText("Selected path")).toBeInTheDocument();
    expect(
      await screen.findByText("Triggers/FM_GORPA_UPD.sql"),
    ).toBeInTheDocument();
    expect(getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/triggers/fm_gorpa_upd.sql",
      { startLine: 66, endLine: 66 },
    );
  });
});
