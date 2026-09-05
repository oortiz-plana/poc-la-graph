import { expect, test } from "@playwright/test";
import {
  openPlsqlConsole,
  searchPlsqlObjects,
} from "./helpers";

// Deterministic PL/SQL analysis console flow over the synthetic fixture
// corpus (docker-compose.synthetic.yml enables PLSQL_ADAPTER=synthetic and
// PLSQL_ENABLED=true). Every assertion targets committed fixture facts; none
// depend on real graph extraction or model output. See
// docs/plsql-analysis/implementation-plan.md (Phase 6 E2E) and
// apps/api/app/integrations/plsql/fixtures.py.
test.beforeEach(async ({ page }) => {
  await openPlsqlConsole(page);
});

test("walks search, detail, dependencies, impact, paths, and source evidence", async ({
  page,
}) => {
  // Search "EMPLOYEES" → exactly three synthetic objects, deterministically
  // ordered (COUNT_EMPLOYEES, EMPLOYEES, TRG_EMPLOYEES_AUDIT).
  await searchPlsqlObjects(page, "EMPLOYEES");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(
    results.getByRole("button", {
      name: /COUNT_EMPLOYEES · HR\.COUNT_EMPLOYEES/,
    }),
  ).toBeVisible();
  const employeesRow = results.getByRole("button", {
    name: /EMPLOYEES · HR\.EMPLOYEES/,
  });
  await expect(employeesRow).toContainText("Table");
  await expect(
    results.getByRole("button", {
      name: /TRG_EMPLOYEES_AUDIT · HR\.TRG_EMPLOYEES_AUDIT/,
    }),
  ).toBeVisible();

  // Open the EMPLOYEES table detail.
  await employeesRow.click();
  const detail = page.getByRole("region", { name: "EMPLOYEES" });
  await expect(detail.getByRole("heading", { name: "EMPLOYEES" })).toBeVisible();
  await expect(detail.getByText("Schema", { exact: true })).toBeVisible();
  await expect(detail.getByText("Qualified name", { exact: true })).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "hr/employees.sql:3" }),
  ).toBeVisible();

  // A table has no callers or callees in the fixture corpus.
  await expect(
    page.getByRole("region", { name: "Callers" }),
  ).toContainText("No callers");
  await expect(
    page.getByRole("region", { name: "Callees" }),
  ).toContainText("No callees");

  // Table access groups by relationship with counts and evidence locations.
  const tableAccess = page.getByRole("region", { name: "Table access" });
  await expect(tableAccess.getByText("READS (3)", { exact: true })).toBeVisible();
  await expect(
    tableAccess.getByText("TRIGGER_ON (1)", { exact: true }),
  ).toBeVisible();
  await expect(
    tableAccess.getByText("VIEW_DEPENDS_ON (1)", { exact: true }),
  ).toBeVisible();
  await expect(tableAccess.getByText("WRITES (1)", { exact: true })).toBeVisible();
  await expect(tableAccess).toContainText("HR.COUNT_EMPLOYEES");

  // Evidence links open the read-only source viewer at the exact file:line.
  await tableAccess
    .getByRole("button", { name: "hr/count_employees.sql:6" })
    .click();
  const source = page.getByRole("region", { name: "Source" });
  await expect(source).toContainText("hr/count_employees.sql");
  await expect(
    source.getByRole("button", { name: "Go to line 6" }),
  ).toBeVisible();
  await source.getByRole("button", { name: "Close source" }).click();
  await expect(page.getByRole("region", { name: "Source" })).toHaveCount(0);

  // The object's declaration source row opens the viewer at line 3.
  await detail.getByRole("button", { name: "hr/employees.sql:3" }).click();
  const declarationSource = page.getByRole("region", { name: "Source" });
  await expect(declarationSource).toContainText("hr/employees.sql");
  await expect(
    declarationSource.getByRole("button", { name: "Go to line 3" }),
  ).toBeVisible();
  await declarationSource.getByRole("button", { name: "Close source" }).click();

  // Impact analysis: bounded, grouped, with an explaining path per dependent.
  const impact = page.getByRole("region", { name: "Impact analysis" });
  await expect(impact).toContainText(
    "Impact scope for HR.EMPLOYEES: 7 dependents — 5 direct, 2 in-transit, 2 tables read or written on the paths below.",
  );
  await expect(
    impact.getByText("Direct dependents", { exact: true }),
  ).toBeVisible();
  await expect(
    impact.getByText("In-transit dependents", { exact: true }),
  ).toBeVisible();
  await expect(
    impact.getByText("Tables read or modified on paths", { exact: true }),
  ).toBeVisible();
  await expect(impact.getByText("READS, WRITES", { exact: true })).toBeVisible();
  const directPaths = impact.getByRole("list", {
    name: "Explaining paths for HR.COUNT_EMPLOYEES",
  });
  await expect(directPaths).toBeVisible();
  await expect(directPaths.getByRole("listitem")).toHaveCount(1);
  await expect(directPaths.getByRole("listitem").first()).toContainText(
    "HR.COUNT_EMPLOYEES",
  );
  await expect(directPaths.getByRole("listitem").first()).toContainText("READS");
  await expect(directPaths.getByRole("listitem").first()).toContainText(
    "HR.EMPLOYEES",
  );

  // The ARCHIVE_EMPLOYEE in-transit dependent has two shortest explaining
  // paths whose final-hop evidence links are rendered.
  const archivePaths = impact.getByRole("list", {
    name: "Explaining paths for HR.ARCHIVE_EMPLOYEE",
  });
  await expect(archivePaths.getByRole("listitem")).toHaveCount(2);
  await expect(archivePaths.getByRole("listitem").first()).toContainText(
    "HR.ARCHIVE_EMPLOYEE",
  );
  await expect(
    archivePaths.getByRole("button", { name: "hr/pkg_employee.pkb:12" }),
  ).toBeVisible();

  // Dependency paths: the search seeded From=COUNT_EMPLOYEES and
  // To=EMPLOYEES, which resolves to exactly one READS path of one hop.
  const paths = page.getByRole("region", { name: "Dependency paths" });
  await expect(paths.getByRole("button", { name: "Find paths" })).toBeEnabled();
  await paths.getByRole("button", { name: "Find paths" }).click();
  const pathList = page.getByRole("list", {
    name: "Dependency paths between the selected objects",
  });
  await expect(pathList.getByRole("listitem")).toHaveCount(1);
  const pathRow = pathList.getByRole("listitem").first();
  await expect(pathRow).toContainText("HR.COUNT_EMPLOYEES");
  await expect(pathRow).toContainText("READS");
  await expect(pathRow).toContainText("HR.EMPLOYEES");
  await expect(pathRow).toContainText("1 hop");

  // Unresolved references are explicit and never presented as certain.
  const unresolved = page.getByRole("region", { name: "Unresolved references" });
  await expect(unresolved.getByText("UNRESOLVED", { exact: true })).toBeVisible();
  await expect(unresolved.getByText("AMBIGUOUS", { exact: true })).toBeVisible();
  await expect(unresolved).toContainText("HR.PKG_LEGACY.RUN_UNKNOWN");
  await expect(unresolved).toContainText("HR.EMPLOYEE_DETAILS");
  await unresolved
    .getByRole("button", { name: "hr/pkg_payroll.pkb:40" })
    .click();
  const unresolvedSource = page.getByRole("region", { name: "Source" });
  await expect(unresolvedSource).toContainText("hr/pkg_payroll.pkb");
  await expect(
    unresolvedSource.getByRole("button", { name: "Go to line 40" }),
  ).toBeVisible();
});

test("surfaces resolution badges and directional views for a package member", async ({
  page,
}) => {
  await searchPlsqlObjects(page, "CALCULATE");
  const results = page.getByRole("region", { name: "Search results" });
  const moraRow = results.getByRole("button", {
    name: /CALCULATE_MORA · HR\.PKG_PAYROLL\.CALCULATE_MORA/,
  });
  await expect(moraRow).toBeVisible();
  await moraRow.click();

  const detail = page.getByRole("region", { name: "CALCULATE_MORA" });
  await expect(detail.getByRole("heading", { name: "CALCULATE_MORA" })).toBeVisible();
  await expect(detail.getByText("PKG_PAYROLL", { exact: true })).toBeVisible();
  await expect(detail.getByText("VARCHAR2", { exact: true })).toBeVisible();
  await expect(detail.getByText("NUMBER", { exact: true })).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "hr/pkg_payroll.pkb:9" }),
  ).toBeVisible();

  // One incoming CALLS edge, exactly resolved.
  const callers = page.getByRole("region", { name: "Callers" });
  await expect(callers).toContainText("HR.PKG_PAYROLL.RUN_PAYROLL");
  await expect(callers.getByText("EXACT", { exact: true })).toBeVisible();

  // Three outgoing CALLS edges carry distinct resolution states.
  const callees = page.getByRole("region", { name: "Callees" });
  await expect(callees.getByText("EXACT", { exact: true })).toBeVisible();
  await expect(callees.getByText("INFERRED", { exact: true })).toBeVisible();
  await expect(callees.getByText("UNRESOLVED", { exact: true })).toBeVisible();
  await expect(callees).toContainText("HR.PKG_EMPLOYEE.CALCULATE_BONUS");
  await expect(callees).toContainText("HR.COUNT_EMPLOYEES");
  await expect(callees).toContainText("HR.PKG_LEGACY.RUN_UNKNOWN");
  await expect(callees.getByRole("button", { name: "hr/pkg_payroll.pkb:40" })).toBeVisible();

  // One table read on the direct paths.
  const tableAccess = page.getByRole("region", { name: "Table access" });
  await expect(tableAccess.getByText("READS (1)", { exact: true })).toBeVisible();
  await expect(tableAccess).toContainText("HR.EMPLOYEES");

  // Impact scope computed from paths: exactly one direct dependent.
  const impact = page.getByRole("region", { name: "Impact analysis" });
  await expect(impact).toContainText(
    "Impact scope for HR.PKG_PAYROLL.CALCULATE_MORA: 1 dependent — 1 direct, 0 in-transit, 0 tables read or written on the paths below.",
  );
  const runPayrollPaths = impact.getByRole("list", {
    name: "Explaining paths for HR.PKG_PAYROLL.RUN_PAYROLL",
  });
  await expect(runPayrollPaths).toBeVisible();
  await expect(runPayrollPaths.getByRole("listitem").first()).toContainText(
    "HR.PKG_PAYROLL.RUN_PAYROLL",
  );
  await expect(runPayrollPaths.getByRole("listitem").first()).toContainText(
    "CALLS",
  );
  await expect(runPayrollPaths.getByRole("listitem").first()).toContainText(
    "HR.PKG_PAYROLL.CALCULATE_MORA",
  );
});
