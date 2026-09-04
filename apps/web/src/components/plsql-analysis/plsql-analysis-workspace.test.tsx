import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlsqlDependency,
  PlsqlDependencyResult,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlObjectSearchResult,
  PlsqlPath,
  PlsqlPathResult,
} from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  searchPlsqlObjects: vi.fn(),
  getPlsqlObject: vi.fn(),
  listPlsqlCallers: vi.fn(),
  listPlsqlCallees: vi.fn(),
  getPlsqlTableAccess: vi.fn(),
  findPlsqlPaths: vi.fn(),
  listPlsqlUnresolved: vi.fn(),
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

describe("PlsqlAnalysisWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.config = { plsqlEnabled: true };
    mocks.listPlsqlCallers.mockResolvedValue(emptyDependencies);
    mocks.listPlsqlCallees.mockResolvedValue(emptyDependencies);
    mocks.getPlsqlTableAccess.mockResolvedValue(emptyDependencies);
    mocks.listPlsqlUnresolved.mockResolvedValue(emptyDependencies);
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
      .mockRejectedValueOnce(new Error("analysis unavailable"))
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

  it("seeds path pickers from search results and renders ordered paths with hop counts", async () => {
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

    await runSearch(user, "pkg");

    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
    const fromSelect = within(section).getByLabelText("Path from object");
    const toSelect = within(section).getByLabelText("Path to object");
    await waitFor(() => {
      expect(fromSelect).toHaveValue(packageObject.id);
      expect(toSelect).toHaveValue(functionObject.id);
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

    await runSearch(user, "pkg");
    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
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

    await runSearch(user, "pkg");
    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
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

    await runSearch(user, "pkg");
    const section = await screen.findByRole("region", {
      name: "Dependency paths",
    });
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
