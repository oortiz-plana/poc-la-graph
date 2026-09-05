import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencyResult,
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
  getPlsqlObject: vi.fn(),
  listPlsqlCallers: vi.fn(),
  listPlsqlCallees: vi.fn(),
  getPlsqlTableAccess: vi.fn(),
  findPlsqlPaths: vi.fn(),
  listPlsqlUnresolved: vi.fn(),
  getPlsqlObjectSource: vi.fn(),
  getPlsqlFileSource: vi.fn(),
  getPlsqlImpact: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  config: { plsqlEnabled: true },
}));

const emptyDependencies: PlsqlDependencyResult = {
  items: [],
  truncated: false,
  count: 0,
};

vi.mock("@/lib/api", () => mocks);
vi.mock("../auth-provider", () => ({
  useAuth: () => ({
    username: "plsql-analyst",
    roles: new Set(["viewer", "editor"]),
    logout: vi.fn(),
    config: authState.config,
  }),
}));

import { PlsqlAnalysisWorkspace } from "./plsql-analysis-workspace";

const packageObject: PlsqlObject = {
  id: "plsql://sample/HR/PACKAGE/PKG_EMP",
  kind: "Package",
  name: "PKG_EMP",
  schema: "HR",
  qualifiedName: "HR.PKG_EMP",
  projectId: "sample",
  owner: null,
  signature: null,
  returnType: null,
  declaration: null,
};

const functionObject: PlsqlObject = {
  id: "plsql://sample/HR/FUNCTION/GET_SALARY",
  kind: "Function",
  name: "GET_SALARY",
  schema: "HR",
  qualifiedName: "HR.GET_SALARY",
  projectId: "sample",
  owner: "HR",
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

const searchFixture: PlsqlObjectSearchResult = {
  items: [packageObject, functionObject],
  truncated: true,
  count: 2,
};

async function runSearch(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
) {
  await user.type(screen.getByLabelText("Search PL/SQL objects"), query);
  await user.click(screen.getByRole("button", { name: "Search objects" }));
}

/**
 * Rejection carrying a backend Problem code, mirroring what the real API
 * client throws (PlsqlApiError). The UI guard is structural, so a plain
 * error object with a `code` property exercises the same branches.
 */
function problemError(
  code: string,
  message = "The analysis service is unavailable.",
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

const emptySearch: PlsqlObjectSearchResult = {
  items: [],
  truncated: false,
  count: 0,
};

/** Type into one From/To picker and choose an option from its listbox. */
async function pickPathObject(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
  queryText: string,
  optionName: string,
): Promise<HTMLInputElement> {
  const field = screen.getByLabelText(fieldLabel) as HTMLInputElement;
  await user.type(field, queryText);
  // The picker debounces for 300ms before searching; allow slack under load.
  await user.click(
    await screen.findByRole("option", { name: optionName }, { timeout: 5000 }),
  );
  return field;
}

describe("PlsqlAnalysisWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.config = { plsqlEnabled: true };
    mocks.listPlsqlCallers.mockResolvedValue(emptyDependencies);
    mocks.listPlsqlCallees.mockResolvedValue(emptyDependencies);
    mocks.getPlsqlTableAccess.mockResolvedValue(emptyDependencies);
    mocks.listPlsqlUnresolved.mockResolvedValue(emptyDependencies);
    mocks.getPlsqlImpact.mockResolvedValue(emptyImpactResult());
    stubMatchMedia(true);
  });

  it("shows a non-interactive message when analysis is not configured", () => {
    authState.config = { plsqlEnabled: false };
    render(<PlsqlAnalysisWorkspace />);

    expect(
      screen.getByRole("heading", { name: "PL/SQL analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Analysis is not configured")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Search PL/SQL objects"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search objects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Dependency paths" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Unresolved references" }),
    ).not.toBeInTheDocument();
    expect(mocks.searchPlsqlObjects).not.toHaveBeenCalled();
    expect(mocks.findPlsqlPaths).not.toHaveBeenCalled();
    expect(mocks.listPlsqlUnresolved).not.toHaveBeenCalled();
  });

  it("searches objects and lists kind badges with a truncation notice", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");

    expect(mocks.searchPlsqlObjects).toHaveBeenCalledWith("pkg");
    const results = await screen.findByRole("region", {
      name: "Search results",
    });
    expect(
      within(results).getByRole("button", { name: /PKG_EMP/ }),
    ).toBeInTheDocument();
    expect(
      within(results).getByRole("button", { name: /GET_SALARY/ }),
    ).toBeInTheDocument();
    expect(within(results).getByText("Package")).toBeInTheDocument();
    expect(within(results).getByText("Function")).toBeInTheDocument();
    expect(
      within(results).getByText("PKG_EMP · HR.PKG_EMP"),
    ).toBeInTheDocument();
    expect(screen.getByText("Results truncated")).toBeInTheDocument();
  });

  it("shows the searching state while a query is in flight", async () => {
    const user = userEvent.setup();
    let resolveSearch: (value: PlsqlObjectSearchResult) => void = () =>
      undefined;
    mocks.searchPlsqlObjects.mockImplementation(
      () =>
        new Promise<PlsqlObjectSearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");

    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    resolveSearch(searchFixture);
    expect(
      await screen.findByRole("button", { name: /PKG_EMP/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });

  it("opens object detail with kind, signature, and source location", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));

    expect(mocks.getPlsqlObject).toHaveBeenCalledWith(functionObject.id);
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    expect(
      within(detail).getByRole("heading", { name: "GET_SALARY" }),
    ).toBeInTheDocument();
    expect(within(detail).getByText("Function")).toBeInTheDocument();
    expect(within(detail).getByText("Schema")).toBeInTheDocument();
    expect(within(detail).getByText("Qualified name")).toBeInTheDocument();
    expect(within(detail).getByText("Project ID")).toBeInTheDocument();
    expect(within(detail).getByText("Owner")).toBeInTheDocument();
    expect(within(detail).getByText("Signature")).toBeInTheDocument();
    expect(within(detail).getByText("Return type")).toBeInTheDocument();
    expect(
      within(detail).getByText(
        "FUNCTION GET_SALARY(p_emp_id IN NUMBER) RETURN NUMBER",
      ),
    ).toBeInTheDocument();
    expect(within(detail).getByText("NUMBER")).toBeInTheDocument();
    expect(within(detail).getByText("hr/pkg_emp.pkb:42")).toBeInTheDocument();
  });

  it("omits null detail fields and clears the detail with Back to results", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(packageObject);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");
    await user.click(await screen.findByRole("button", { name: /PKG_EMP/ }));

    const detail = await screen.findByRole("region", { name: "PKG_EMP" });
    expect(within(detail).getByText("Package")).toBeInTheDocument();
    expect(within(detail).queryByText("Owner")).not.toBeInTheDocument();
    expect(within(detail).queryByText("Signature")).not.toBeInTheDocument();
    expect(within(detail).queryByText("Return type")).not.toBeInTheDocument();
    expect(within(detail).queryByText("Source")).not.toBeInTheDocument();

    await user.click(
      within(detail).getByRole("button", { name: "Back to results" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "PKG_EMP" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an empty message when no objects match", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "zzz");

    expect(mocks.searchPlsqlObjects).toHaveBeenCalledWith("zzz");
    expect(await screen.findByText("No objects match")).toBeInTheDocument();
  });

  it("shows an alert on search failure and retries the query", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects
      .mockRejectedValueOnce(problemError("analysis_unavailable"))
      .mockResolvedValue(searchFixture);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.searchPlsqlObjects).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("button", { name: /PKG_EMP/ }),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry on search", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
    expect(mocks.searchPlsqlObjects).toHaveBeenCalledTimes(1);
  });

  it("shows the deterministic size-limit error without a retry on object detail", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
    expect(mocks.getPlsqlObject).toHaveBeenCalledTimes(1);
  });

  it("renders caller edges with resolution and evidence next to detail", async () => {
    const user = userEvent.setup();
    const callEdge = dependencyFixture({
      id: "edge://sample/CALLS/RUN_PAYROLL/GET_SALARY",
      relationship: "CALLS",
      resolution: "INFERRED",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/PROCEDURE/RUN_PAYROLL",
        "Procedure",
        "RUN_PAYROLL",
        "HR.PKG_PAYROLL.RUN_PAYROLL",
      ),
      target: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        "HR.GET_SALARY",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 34,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.listPlsqlCallers.mockResolvedValue({
      items: [callEdge],
      truncated: false,
      count: 1,
    });
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));

    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    expect(mocks.listPlsqlCallers).toHaveBeenCalledWith(functionObject.id);
    expect(mocks.listPlsqlCallees).toHaveBeenCalledWith(functionObject.id);
    expect(mocks.getPlsqlTableAccess).toHaveBeenCalledWith(functionObject.id);
    expect(
      await within(detail).findByRole("heading", { name: "Callers" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const rows = within(detail).getAllByRole("listitem");
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
    expect(within(detail).getByText("INFERRED")).toBeInTheDocument();
    expect(
      within(detail).getByText("hr/pkg_payroll.pkb:34"),
    ).toBeInTheDocument();
    expect(await within(detail).findByText("No callees")).toBeInTheDocument();
    expect(within(detail).getByText("No table access")).toBeInTheDocument();
  });

  it("groups table access by relationship and flags truncation", async () => {
    const user = userEvent.setup();
    const readsEmployees = dependencyFixture({
      id: "edge://sample/READS/CALCULATE_MORA/EMPLOYEES",
      relationship: "READS",
      resolution: "EXACT",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/FUNCTION/CALCULATE_MORA",
        "Function",
        "CALCULATE_MORA",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
      ),
      target: referenceFixture(
        "plsql://sample/HR/TABLE/EMPLOYEES",
        "Table",
        "EMPLOYEES",
        "HR.EMPLOYEES",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 13,
        startColumn: 1,
        startOffset: 10,
        endOffset: 20,
      },
    });
    const writesDepartments = dependencyFixture({
      id: "edge://sample/WRITES/RUN_PAYROLL/DEPARTMENTS",
      relationship: "WRITES",
      resolution: "EXACT",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/PROCEDURE/RUN_PAYROLL",
        "Procedure",
        "RUN_PAYROLL",
        "HR.PKG_PAYROLL.RUN_PAYROLL",
      ),
      target: referenceFixture(
        "plsql://sample/HR/TABLE/DEPARTMENTS",
        "Table",
        "DEPARTMENTS",
        "HR.DEPARTMENTS",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 36,
        startColumn: 1,
        startOffset: 30,
        endOffset: 40,
      },
    });
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(packageObject);
    mocks.getPlsqlTableAccess.mockResolvedValue({
      items: [readsEmployees, writesDepartments],
      truncated: true,
      count: 2,
    });
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");
    await user.click(await screen.findByRole("button", { name: /PKG_EMP/ }));

    const detail = await screen.findByRole("region", { name: "PKG_EMP" });
    expect(
      await within(detail).findByRole("heading", { name: "Table access" }),
    ).toBeInTheDocument();
    expect(await within(detail).findByText("READS (1)")).toBeInTheDocument();
    expect(within(detail).getByText("WRITES (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Results truncated")).toBeInTheDocument();
    await waitFor(() => {
      const rows = within(detail).getAllByRole("listitem");
      const text = rows.map((row) => row.textContent ?? "").join("\n");
      expect(text).toContain("CALCULATE_MORA");
      expect(text).toContain("READS");
      expect(text).toContain("EMPLOYEES");
      expect(text).toContain("RUN_PAYROLL");
      expect(text).toContain("WRITES");
      expect(text).toContain("DEPARTMENTS");
    });
  });

  it("retries a failed dependency section independently", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(packageObject);
    mocks.listPlsqlCallees
      .mockRejectedValueOnce(new Error("analysis unavailable"))
      .mockResolvedValue(emptyDependencies);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");
    await user.click(await screen.findByRole("button", { name: /PKG_EMP/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.listPlsqlCallees).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("No callees")).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry in a dependency section", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(packageObject);
    mocks.listPlsqlCallees.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "pkg");
    await user.click(await screen.findByRole("button", { name: /PKG_EMP/ }));

    const detail = await screen.findByRole("region", { name: "PKG_EMP" });
    const alert = await within(detail).findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
  });

  it("searches path endpoints through the pickers and renders ordered paths with hop counts", async () => {
    const user = userEvent.setup();
    const employeesRef = referenceFixture(
      "plsql://sample/HR/TABLE/EMPLOYEES",
      "Table",
      "EMPLOYEES",
      "HR.EMPLOYEES",
    );
    const pathOne: PlsqlPath = {
      id: "path://sample/direct",
      hopCount: 1,
      nodes: [packageRef(packageObject), packageRef(functionObject)],
      relationships: [
        dependencyFixture({
          id: "edge://sample/CALLS/PKG_EMP/GET_SALARY",
          relationship: "CALLS",
          resolution: "EXACT",
          source: packageRef(packageObject),
          target: packageRef(functionObject),
          evidence: null,
        }),
      ],
    };
    const pathTwo: PlsqlPath = {
      id: "path://sample/via-table",
      hopCount: 2,
      nodes: [
        packageRef(packageObject),
        packageRef(functionObject),
        employeesRef,
      ],
      relationships: [
        dependencyFixture({
          id: "edge://sample/CALLS/PKG_EMP/GET_SALARY",
          relationship: "CALLS",
          resolution: "EXACT",
          source: packageRef(packageObject),
          target: packageRef(functionObject),
          evidence: null,
        }),
        dependencyFixture({
          id: "edge://sample/READS/GET_SALARY/EMPLOYEES",
          relationship: "READS",
          resolution: "EXACT",
          source: packageRef(functionObject),
          target: employeesRef,
          evidence: null,
        }),
      ],
    };
    const paths: PlsqlPathResult = {
      items: [pathOne, pathTwo],
      truncated: false,
      count: 2,
    };
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.findPlsqlPaths.mockResolvedValue(paths);
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    // The pickers search through the API on their own; the main results
    // list is never involved.
    const fromField = await pickPathObject(
      user,
      "From object",
      "pkg",
      "Package · HR.PKG_EMP",
    );
    const toField = await pickPathObject(
      user,
      "To object",
      "salary",
      "Function · HR.GET_SALARY",
    );
    expect(fromField).toHaveValue("Package · HR.PKG_EMP");
    expect(toField).toHaveValue("Function · HR.GET_SALARY");
    expect(mocks.searchPlsqlObjects).toHaveBeenCalledWith("pkg", { limit: 10 });
    expect(mocks.searchPlsqlObjects).toHaveBeenCalledWith("salary", {
      limit: 10,
    });
    await user.click(
      within(section).getByRole("button", { name: "Find paths" }),
    );

    expect(mocks.findPlsqlPaths).toHaveBeenCalledWith(
      packageObject.id,
      functionObject.id,
    );
    const list = await within(section).findByRole("list", {
      name: "Dependency paths between the selected objects",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Server order is preserved (deterministic): the 1-hop route first.
    const first = rows[0].textContent ?? "";
    const second = rows[1].textContent ?? "";
    expect(first).toContain("HR.PKG_EMP");
    expect(first).toContain("CALLS");
    expect(first).toContain("HR.GET_SALARY");
    expect(first).toContain("1 hop");
    expect(first).not.toContain("READS");
    expect(second).toContain("HR.PKG_EMP");
    expect(second).toContain("READS");
    expect(second).toContain("HR.EMPLOYEES");
    expect(second).toContain("2 hops");
  });

  it("flags truncated dependency path results and shows an empty state", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.findPlsqlPaths.mockResolvedValue({
      items: [emptyPath()],
      truncated: true,
      count: 1,
    });
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    await pickPathObject(user, "From object", "pkg", "Package · HR.PKG_EMP");
    await pickPathObject(
      user,
      "To object",
      "salary",
      "Function · HR.GET_SALARY",
    );
    await user.click(
      within(section).getByRole("button", { name: "Find paths" }),
    );

    expect(
      await within(section).findByText("Results truncated"),
    ).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(1);

    mocks.findPlsqlPaths.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    await user.click(
      within(section).getByRole("button", { name: "Find paths" }),
    );
    expect(
      await within(section).findByText("No dependency paths found"),
    ).toBeInTheDocument();
  });

  it("requires distinct From and To objects before tracing", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue({
      items: [packageObject],
      truncated: false,
      count: 1,
    });
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    await pickPathObject(user, "From object", "pkg", "Package · HR.PKG_EMP");
    await pickPathObject(user, "To object", "pkg", "Package · HR.PKG_EMP");
    expect(
      within(section).getByRole("button", { name: "Find paths" }),
    ).toBeDisabled();
    expect(
      within(section).getByText(
        "Choose two different searched objects to trace paths between them.",
      ),
    ).toBeInTheDocument();
    expect(mocks.findPlsqlPaths).not.toHaveBeenCalled();
  });

  it("retries a failed dependency path query independently", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.findPlsqlPaths
      .mockRejectedValueOnce(new Error("analysis unavailable"))
      .mockResolvedValue({ items: [emptyPath()], truncated: true, count: 1 });
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    await pickPathObject(user, "From object", "pkg", "Package · HR.PKG_EMP");
    await pickPathObject(
      user,
      "To object",
      "salary",
      "Function · HR.GET_SALARY",
    );
    await user.click(
      within(section).getByRole("button", { name: "Find paths" }),
    );

    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.findPlsqlPaths).toHaveBeenCalledTimes(2);
    expect(
      await within(section).findByText("Results truncated"),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry for dependency paths", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.findPlsqlPaths.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    await pickPathObject(user, "From object", "pkg", "Package · HR.PKG_EMP");
    await pickPathObject(
      user,
      "To object",
      "salary",
      "Function · HR.GET_SALARY",
    );
    await user.click(
      within(section).getByRole("button", { name: "Find paths" }),
    );

    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
  });

  it("debounces picker searches while typing", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(emptySearch);
    render(<PlsqlAnalysisWorkspace />);

    const fromField = screen.getByLabelText("From object");
    await user.type(fromField, "pk");
    expect(mocks.searchPlsqlObjects).not.toHaveBeenCalled();
    await user.type(fromField, "g");
    expect(mocks.searchPlsqlObjects).not.toHaveBeenCalled();
    await waitFor(
      () => expect(mocks.searchPlsqlObjects).toHaveBeenCalledTimes(1),
      { timeout: 5000 },
    );
    expect(mocks.searchPlsqlObjects).toHaveBeenCalledWith("pkg", { limit: 10 });
  });

  it("shows an empty state when no objects match a picker query", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(emptySearch);
    render(<PlsqlAnalysisWorkspace />);

    const fromField = screen.getByLabelText("From object");
    await user.type(fromField, "zzz");

    const listbox = await screen.findByRole("listbox", {
      name: "From object matches",
    });
    expect(
      await within(listbox).findByText("No matching objects", undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(within(listbox).queryByRole("option")).not.toBeInTheDocument();
  });

  it("distinguishes picker options that share a qualified name by kind", async () => {
    const user = userEvent.setup();
    const synonym: PlsqlObject = {
      ...packageObject,
      id: "plsql://sample/HR/SYNONYM/PKG_EMP",
      kind: "Synonym",
    };
    mocks.searchPlsqlObjects.mockResolvedValue({
      items: [packageObject, synonym],
      truncated: false,
      count: 2,
    });
    render(<PlsqlAnalysisWorkspace />);

    const fromField = screen.getByLabelText("From object");
    await user.type(fromField, "pkg");

    // Wait for the debounced search results before asserting the options.
    await screen.findByRole(
      "option",
      { name: "Package · HR.PKG_EMP" },
      { timeout: 5000 },
    );
    const listbox = screen.getByRole("listbox", {
      name: "From object matches",
    });
    expect(
      within(listbox).getByRole("option", { name: "Package · HR.PKG_EMP" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "Synonym · HR.PKG_EMP" }),
    ).toBeInTheDocument();
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
  });

  it("supports keyboard selection in the pickers", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockImplementation(async (query: string) =>
      query.includes("salary")
        ? { items: [functionObject], truncated: false, count: 1 }
        : searchFixture,
    );
    mocks.findPlsqlPaths.mockResolvedValue({
      items: [emptyPath()],
      truncated: false,
      count: 1,
    });
    render(<PlsqlAnalysisWorkspace />);

    const fromField = screen.getByLabelText("From object");
    await user.type(fromField, "pkg");
    const option = await screen.findByRole(
      "option",
      { name: "Package · HR.PKG_EMP" },
      { timeout: 5000 },
    );
    expect(option).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(fromField).toHaveValue("Package · HR.PKG_EMP");

    const toField = screen.getByLabelText("To object");
    await user.type(toField, "salary");
    await screen.findByRole(
      "option",
      { name: "Function · HR.GET_SALARY" },
      { timeout: 5000 },
    );
    await user.keyboard("{ArrowDown}{Enter}");
    expect(toField).toHaveValue("Function · HR.GET_SALARY");

    expect(screen.getByRole("button", { name: "Find paths" })).toBeEnabled();
  });

  it("renders unresolved references as warnings with resolution labels", async () => {
    const unresolvedEdge = dependencyFixture({
      id: "edge://sample/CALLS/CALCULATE_MORA/RUN_UNKNOWN",
      relationship: "CALLS",
      resolution: "UNRESOLVED",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/FUNCTION/CALCULATE_MORA",
        "Function",
        "CALCULATE_MORA",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
      ),
      target: referenceFixture(
        "plsql://sample/HR/PKG_LEGACY/RUN_UNKNOWN",
        "Procedure",
        "RUN_UNKNOWN",
        "HR.PKG_LEGACY.RUN_UNKNOWN",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 40,
        startColumn: 1,
        startOffset: 512,
        endOffset: 520,
      },
    });
    const ambiguousEdge = dependencyFixture({
      id: "edge://sample/READS/ARCHIVE_EMPLOYEE/EMPLOYEE_DETAILS",
      relationship: "READS",
      resolution: "AMBIGUOUS",
      source: referenceFixture(
        "plsql://sample/HR/PROCEDURE/ARCHIVE_EMPLOYEE",
        "Procedure",
        "ARCHIVE_EMPLOYEE",
        "HR.ARCHIVE_EMPLOYEE",
      ),
      target: referenceFixture(
        "plsql://sample/HR/VIEW/EMPLOYEE_DETAILS",
        "View",
        "EMPLOYEE_DETAILS",
        "HR.EMPLOYEE_DETAILS",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/archive_employee.sql",
        path: "hr/archive_employee.sql",
        startLine: 9,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.listPlsqlUnresolved.mockResolvedValue({
      items: [unresolvedEdge, ambiguousEdge],
      truncated: false,
      count: 2,
    });
    render(<PlsqlAnalysisWorkspace />);

    const section = await screen.findByRole("region", {
      name: "Unresolved references",
    });
    expect(
      within(section).getByText(/could not be resolved with certainty/),
    ).toBeInTheDocument();
    await waitFor(() => {
      const rows = within(section).getAllByRole("listitem");
      const text = rows.map((row) => row.textContent ?? "").join("\n");
      expect(text).toContain("CALCULATE_MORA");
      expect(text).toContain("CALLS");
      expect(text).toContain("RUN_UNKNOWN");
      expect(text).toContain("UNRESOLVED");
      expect(text).toContain("ARCHIVE_EMPLOYEE");
      expect(text).toContain("READS");
      expect(text).toContain("EMPLOYEE_DETAILS");
      expect(text).toContain("AMBIGUOUS");
    });
    expect(within(section).getByText("UNRESOLVED")).toBeInTheDocument();
    expect(within(section).getByText("AMBIGUOUS")).toBeInTheDocument();
    expect(
      within(section).getByText("hr/pkg_payroll.pkb:40"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("hr/archive_employee.sql:9"),
    ).toBeInTheDocument();
    expect(
      within(section).queryByText("Results truncated"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no unresolved references", async () => {
    render(<PlsqlAnalysisWorkspace />);

    expect(mocks.listPlsqlUnresolved).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("No unresolved references"),
    ).toBeInTheDocument();
  });

  it("retries a failed unresolved references section", async () => {
    const user = userEvent.setup();
    mocks.listPlsqlUnresolved
      .mockRejectedValueOnce(new Error("analysis unavailable"))
      .mockResolvedValue(emptyDependencies);
    render(<PlsqlAnalysisWorkspace />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.listPlsqlUnresolved).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("No unresolved references"),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry in unresolved references", async () => {
    mocks.listPlsqlUnresolved.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
    expect(mocks.listPlsqlUnresolved).toHaveBeenCalledTimes(1);
  });

  it("opens the object source viewer and highlights its declaration line", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    expect(mocks.getPlsqlObjectSource).toHaveBeenCalledWith(functionObject.id);
    const source = await screen.findByRole("region", { name: "Source" });
    expect(
      within(source).getByRole("heading", { name: "Source" }),
    ).toBeInTheDocument();
    expect(within(source).getByText("hr/pkg_emp.pkb")).toBeInTheDocument();
    const list = within(source).getByRole("list", { name: "File lines" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(42);
    expect(rows[41]).toHaveAttribute("aria-current", "location");
    expect(within(source).getByText("return l_salary;")).toBeInTheDocument();
  });

  it("focuses the highlighted line through the keyboard fallback", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const source = await screen.findByRole("region", { name: "Source" });
    await user.click(
      within(source).getByRole("button", { name: "Go to line 42" }),
    );
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute(
        "id",
        "plsql-source-line-42",
      );
    });
  });

  it("opens the source viewer from an evidence location with its file and line", async () => {
    const user = userEvent.setup();
    const callEdge = dependencyFixture({
      id: "edge://sample/CALLS/RUN_PAYROLL/GET_SALARY",
      relationship: "CALLS",
      resolution: "INFERRED",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/PROCEDURE/RUN_PAYROLL",
        "Procedure",
        "RUN_PAYROLL",
        "HR.PKG_PAYROLL.RUN_PAYROLL",
      ),
      target: referenceFixture(
        functionObject.id,
        "Function",
        "GET_SALARY",
        "HR.GET_SALARY",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_emp.pkb",
        path: "hr/pkg_emp.pkb",
        startLine: 5,
        startColumn: 1,
        startOffset: 100,
        endOffset: 120,
      },
    });
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.listPlsqlCallers.mockResolvedValue({
      items: [callEdge],
      truncated: false,
      count: 1,
    });
    mocks.getPlsqlFileSource.mockResolvedValue(sourceContentFixture(5));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      await within(detail).findByRole("button", {
        name: "hr/pkg_emp.pkb:5",
      }),
    );

    expect(mocks.getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/pkg_emp.pkb",
      { startLine: 5 },
    );
    const source = await screen.findByRole("region", { name: "Source" });
    expect(within(source).getByText("hr/pkg_emp.pkb")).toBeInTheDocument();
    const list = within(source).getByRole("list", { name: "File lines" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[4]).toHaveAttribute("aria-current", "location");
  });

  it("opens the source viewer from an unresolved reference row", async () => {
    const user = userEvent.setup();
    const unresolvedEdge = dependencyFixture({
      id: "edge://sample/CALLS/CALCULATE_MORA/RUN_UNKNOWN",
      relationship: "CALLS",
      resolution: "UNRESOLVED",
      source: referenceFixture(
        "plsql://sample/HR/PACKAGE/PKG_PAYROLL/FUNCTION/CALCULATE_MORA",
        "Function",
        "CALCULATE_MORA",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
      ),
      target: referenceFixture(
        "plsql://sample/HR/PKG_LEGACY/RUN_UNKNOWN",
        "Procedure",
        "RUN_UNKNOWN",
        "HR.PKG_LEGACY.RUN_UNKNOWN",
      ),
      evidence: {
        sourceFileId: "file://sample/hr/pkg_payroll.pkb",
        path: "hr/pkg_payroll.pkb",
        startLine: 40,
        startColumn: 1,
        startOffset: 512,
        endOffset: 520,
      },
    });
    mocks.listPlsqlUnresolved.mockResolvedValue({
      items: [unresolvedEdge],
      truncated: false,
      count: 1,
    });
    mocks.getPlsqlFileSource.mockResolvedValue(
      sourceContentFixture(
        40,
        "hr/pkg_payroll.pkb",
        "file://sample/hr/pkg_payroll.pkb",
      ),
    );
    render(<PlsqlAnalysisWorkspace />);

    const unresolved = await screen.findByRole("region", {
      name: "Unresolved references",
    });
    await user.click(
      await within(unresolved).findByRole("button", {
        name: "hr/pkg_payroll.pkb:40",
      }),
    );

    expect(mocks.getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/pkg_payroll.pkb",
      { startLine: 40 },
    );
    const source = await screen.findByRole("region", { name: "Source" });
    expect(within(source).getByText("hr/pkg_payroll.pkb")).toBeInTheDocument();
    expect(within(source).getByText("Go to line 40")).toBeInTheDocument();
  });

  it("shows the source loading state and retries after a failure", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    let resolveSource: (value: PlsqlSourceContent) => void = () => undefined;
    mocks.getPlsqlObjectSource.mockImplementationOnce(
      () =>
        new Promise<PlsqlSourceContent>((resolve) => {
          resolveSource = resolve;
        }),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    expect(await screen.findByText("Loading source…")).toBeInTheDocument();
    resolveSource(sourceContentFixture(42));
    expect(
      await screen.findByRole("region", { name: "Source" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close source" }));
    mocks.getPlsqlObjectSource
      .mockRejectedValueOnce(new Error("analysis unavailable"))
      .mockResolvedValue(sourceContentFixture(42));
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.getPlsqlObjectSource).toHaveBeenCalledTimes(3);
    expect(
      await screen.findByRole("region", { name: "Source" }),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry in the source viewer", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
    expect(mocks.getPlsqlObjectSource).toHaveBeenCalledTimes(1);
  });

  it("copies the source path and closes the panel", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const source = await screen.findByRole("region", { name: "Source" });
    await user.click(within(source).getByRole("button", { name: "Copy path" }));
    expect(writeText).toHaveBeenCalledWith("hr/pkg_emp.pkb");
    expect(
      await within(source).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    await user.click(
      within(source).getByRole("button", { name: "Close source" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Source" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens the source viewer in the sheet drawer on narrow screens", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Source" });
    expect(within(dialog).getByText("hr/pkg_emp.pkb")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("renders the impact report grouped with explaining paths and evidence links", async () => {
    const user = userEvent.setup();
    const moraRef = referenceFixture(
      "plsql://sample/HR/PACKAGE/PKG_PAYROLL/FUNCTION/CALCULATE_MORA",
      "Function",
      "CALCULATE_MORA",
      "HR.PKG_PAYROLL.CALCULATE_MORA",
    );
    const payrollRef = referenceFixture(
      "plsql://sample/HR/PACKAGE/PKG_PAYROLL/PROCEDURE/RUN_PAYROLL",
      "Procedure",
      "RUN_PAYROLL",
      "HR.PKG_PAYROLL.RUN_PAYROLL",
    );
    const callEdge = (
      id: string,
      source: PlsqlObjectReference,
      startLine: number,
    ) =>
      dependencyFixture({
        id,
        relationship: "CALLS",
        resolution: "EXACT",
        source,
        target: packageRef(functionObject),
        evidence: {
          sourceFileId: "file://sample/hr/pkg_payroll.pkb",
          path: "hr/pkg_payroll.pkb",
          startLine,
          startColumn: 1,
          startOffset: 100,
          endOffset: 120,
        },
      });
    const directPath: PlsqlPath = {
      id: "path://sample/direct-mora",
      hopCount: 1,
      nodes: [moraRef, packageRef(functionObject)],
      relationships: [
        callEdge("edge://sample/CALLS/MORA/GET_SALARY", moraRef, 11),
      ],
    };
    const transitPath: PlsqlPath = {
      id: "path://sample/transit-run",
      hopCount: 2,
      nodes: [payrollRef, moraRef, packageRef(functionObject)],
      relationships: [
        callEdge("edge://sample/CALLS/RUN/MORA", payrollRef, 11),
        callEdge("edge://sample/CALLS/MORA/GET_SALARY", moraRef, 34),
      ],
    };
    const impact: PlsqlImpactResult = {
      object: packageRef(functionObject),
      items: [
        {
          id: "impact://sample/mora/d1",
          dependent: moraRef,
          distance: 1,
          paths: [directPath],
        },
        {
          id: "impact://sample/run/d2",
          dependent: payrollRef,
          distance: 2,
          paths: [transitPath],
        },
      ],
      truncated: false,
      count: 2,
    };
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlImpact.mockResolvedValue(impact);
    mocks.getPlsqlFileSource.mockResolvedValue(sourceContentFixture(11));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    const report = await within(detail).findByRole("region", {
      name: "Impact analysis",
    });
    expect(mocks.getPlsqlImpact).toHaveBeenCalledWith(functionObject.id);
    expect(
      within(report).getByText(
        /2 dependents — 1 direct, 1 in-transit, 0 tables read or written/,
      ),
    ).toBeInTheDocument();
    expect(
      within(report).getByRole("heading", { name: "Direct dependents" }),
    ).toBeInTheDocument();
    expect(
      within(report).getByRole("heading", { name: "In-transit dependents" }),
    ).toBeInTheDocument();
    const rows = within(report).getAllByRole("listitem");
    const text = rows.map((row) => row.textContent ?? "").join("\n");
    expect(text).toContain("HR.PKG_PAYROLL.CALCULATE_MORA");
    expect(text).toContain("1 hop");
    expect(text).toContain("HR.PKG_PAYROLL.RUN_PAYROLL");
    expect(text).toContain("2 hops");
    expect(text).toContain("CALLS");

    // The final hop's evidence links into the source viewer.
    await user.click(
      within(report).getByRole("button", { name: "hr/pkg_payroll.pkb:34" }),
    );
    expect(mocks.getPlsqlFileSource).toHaveBeenCalledWith(
      "file://sample/hr/pkg_payroll.pkb",
      { startLine: 34 },
    );
    expect(
      await screen.findByRole("region", { name: "Source" }),
    ).toBeInTheDocument();
  });

  it("lists tables read or modified on explaining paths", async () => {
    const user = userEvent.setup();
    const employeesRef = referenceFixture(
      "plsql://sample/HR/TABLE/EMPLOYEES",
      "Table",
      "EMPLOYEES",
      "HR.EMPLOYEES",
    );
    const writerRef = referenceFixture(
      "plsql://sample/HR/PACKAGE/PKG_EMPLOYEE/PROCEDURE/CREATE_EMPLOYEE",
      "Procedure",
      "CREATE_EMPLOYEE",
      "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
    );
    const writePath: PlsqlPath = {
      id: "path://sample/writes-employees",
      hopCount: 1,
      nodes: [writerRef, employeesRef],
      relationships: [
        dependencyFixture({
          id: "edge://sample/WRITES/CREATE_EMPLOYEE/EMPLOYEES",
          relationship: "WRITES",
          resolution: "EXACT",
          source: writerRef,
          target: employeesRef,
          evidence: {
            sourceFileId: "file://sample/hr/pkg_employee.pkb",
            path: "hr/pkg_employee.pkb",
            startLine: 12,
            startColumn: 1,
            startOffset: 90,
            endOffset: 110,
          },
        }),
      ],
    };
    const impact: PlsqlImpactResult = {
      object: employeesRef,
      items: [
        {
          id: "impact://sample/writer/d1",
          dependent: writerRef,
          distance: 1,
          paths: [writePath],
        },
      ],
      truncated: false,
      count: 1,
    };
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlImpact.mockResolvedValue(impact);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const report = await screen.findByRole("region", {
      name: "Impact analysis",
    });
    expect(
      within(report).getByText("Tables read or modified on paths"),
    ).toBeInTheDocument();
    const text = within(report)
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "")
      .join("\n");
    expect(text).toContain("HR.EMPLOYEES");
    expect(text).toContain("WRITES");
  });

  it("flags truncated impact reports and shows the empty state", async () => {
    const user = userEvent.setup();
    const moraRef = referenceFixture(
      "plsql://sample/HR/PACKAGE/PKG_PAYROLL/FUNCTION/CALCULATE_MORA",
      "Function",
      "CALCULATE_MORA",
      "HR.PKG_PAYROLL.CALCULATE_MORA",
    );
    const directPath: PlsqlPath = {
      id: "path://sample/direct-mora",
      hopCount: 1,
      nodes: [moraRef, packageRef(functionObject)],
      relationships: [
        dependencyFixture({
          id: "edge://sample/CALLS/MORA/GET_SALARY",
          relationship: "CALLS",
          resolution: "EXACT",
          source: moraRef,
          target: packageRef(functionObject),
          evidence: {
            sourceFileId: "file://sample/hr/pkg_payroll.pkb",
            path: "hr/pkg_payroll.pkb",
            startLine: 11,
            startColumn: 1,
            startOffset: 100,
            endOffset: 120,
          },
        }),
      ],
    };
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlImpact.mockResolvedValue({
      object: packageRef(functionObject),
      items: [
        {
          id: "impact://sample/mora/d1",
          dependent: moraRef,
          distance: 1,
          paths: [directPath],
        },
      ],
      truncated: true,
      count: 3,
    });
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const report = await screen.findByRole("region", {
      name: "Impact analysis",
    });
    expect(within(report).getByText("Results truncated")).toBeInTheDocument();
    expect(
      within(report).getByText(/3 dependents — 1 direct, 0 in-transit/),
    ).toBeInTheDocument();
  });

  it("retries a failed impact analysis section", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlImpact
      .mockRejectedValueOnce(new Error("analysis unavailable"))
      .mockResolvedValue({
        object: packageRef(functionObject),
        items: [],
        truncated: false,
        count: 0,
      });
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const report = await screen.findByRole("region", {
      name: "Impact analysis",
    });
    const alert = await within(report).findByRole("alert");
    expect(alert).toHaveTextContent("Analysis is unavailable");
    await user.click(
      within(alert).getByRole("button", { name: "Retry analysis query" }),
    );
    expect(mocks.getPlsqlImpact).toHaveBeenCalledTimes(2);
    expect(
      await within(report).findByText("No impacted dependents"),
    ).toBeInTheDocument();
  });

  it("shows the deterministic size-limit error without a retry for impact analysis", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlImpact.mockRejectedValue(
      problemError("analysis_limit_exceeded"),
    );
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const report = await screen.findByRole("region", {
      name: "Impact analysis",
    });
    const alert = await within(report).findByRole("alert");
    expect(alert).toHaveTextContent(
      "This project is too large to compute this view right now.",
    );
    expect(
      within(alert).queryByRole("button", { name: "Retry analysis query" }),
    ).not.toBeInTheDocument();
    expect(mocks.getPlsqlImpact).toHaveBeenCalledTimes(1);
  });

  // --- Phase 6 accessibility regression cases -----------------------------

  it("announces search completion through a polite live region", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");

    const announcement = await screen.findByText(
      "Search complete: 2 matching objects.",
    );
    expect(announcement).toHaveAttribute("aria-live", "polite");
  });

  it("moves focus to the object detail heading when it opens", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));

    const heading = await screen.findByRole("heading", { name: "GET_SALARY" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("restores focus to the result row with Back to results", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    const row = await screen.findByRole("button", { name: /GET_SALARY/ });
    await user.click(row);
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "Back to results" }),
    );

    await waitFor(() => expect(row).toHaveFocus());
    expect(
      screen.queryByRole("region", { name: "GET_SALARY" }),
    ).not.toBeInTheDocument();
  });

  it("moves focus to the source panel heading when it opens", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const heading = await screen.findByRole("heading", { name: "Source" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("restores focus to the evidence link when the source panel closes", async () => {
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    const evidence = within(detail).getByRole("button", {
      name: "hr/pkg_emp.pkb:42",
    });
    await user.click(evidence);

    const source = await screen.findByRole("region", { name: "Source" });
    await user.click(
      within(source).getByRole("button", { name: "Close source" }),
    );

    await waitFor(() => expect(evidence).toHaveFocus());
    expect(
      screen.queryByRole("region", { name: "Source" }),
    ).not.toBeInTheDocument();
  });

  it("moves focus to the source sheet heading on narrow screens", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Source" });
    const heading = within(dialog).getByRole("heading", { name: "Source" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("announces the copied source path politely", async () => {
    stubClipboard();
    const user = userEvent.setup();
    mocks.searchPlsqlObjects.mockResolvedValue(searchFixture);
    mocks.getPlsqlObject.mockResolvedValue(functionObject);
    mocks.getPlsqlObjectSource.mockResolvedValue(sourceContentFixture(42));
    render(<PlsqlAnalysisWorkspace />);

    await runSearch(user, "salary");
    await user.click(await screen.findByRole("button", { name: /GET_SALARY/ }));
    const detail = await screen.findByRole("region", { name: "GET_SALARY" });
    await user.click(
      within(detail).getByRole("button", { name: "hr/pkg_emp.pkb:42" }),
    );
    const source = await screen.findByRole("region", { name: "Source" });
    await user.click(within(source).getByRole("button", { name: "Copy path" }));

    const notice = await within(source).findByText(
      "Source path copied to clipboard.",
    );
    expect(notice).toHaveAttribute("aria-live", "polite");
  });
});

function referenceFixture(
  id: string,
  kind: PlsqlObjectReference["kind"],
  name: string,
  qualifiedName: string,
  schema = "HR",
): PlsqlObjectReference {
  return { id, kind, name, schema, qualifiedName };
}

function packageRef(object: PlsqlObject): PlsqlObjectReference {
  return {
    id: object.id,
    kind: object.kind,
    name: object.name,
    schema: object.schema,
    qualifiedName: object.qualifiedName,
  };
}

function dependencyFixture(
  values: Pick<
    PlsqlDependency,
    "id" | "relationship" | "resolution" | "source" | "target" | "evidence"
  >,
): PlsqlDependency {
  return values as PlsqlDependency;
}

function emptyPath(): PlsqlPath {
  return {
    id: "path://sample/empty",
    hopCount: 1,
    nodes: [packageRef(packageObject), packageRef(functionObject)],
    relationships: [
      dependencyFixture({
        id: "edge://sample/CALLS/PKG_EMP/GET_SALARY",
        relationship: "CALLS",
        resolution: "EXACT",
        source: packageRef(packageObject),
        target: packageRef(functionObject),
        evidence: null,
      }),
    ],
  };
}

function emptyImpactResult(): PlsqlImpactResult {
  return {
    object: packageRef(packageObject),
    items: [],
    truncated: false,
    count: 0,
  };
}

function sourceContentFixture(
  highlightLine: number,
  path = "hr/pkg_emp.pkb",
  fileId = "file://sample/hr/pkg_emp.pkb",
): PlsqlSourceContent {
  const total = Math.max(highlightLine, 7);
  const lines = Array.from({ length: total }, (_, index) =>
    index + 1 === highlightLine
      ? "    return l_salary;"
      : `    -- synthetic line ${index + 1}`,
  );
  return {
    file: { fileId, path },
    lines,
    highlight: { startLine: highlightLine, endLine: highlightLine },
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

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}
