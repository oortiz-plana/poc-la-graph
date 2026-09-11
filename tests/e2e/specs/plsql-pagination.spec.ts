import { expect, test } from "@playwright/test";

// Browser integration over deterministic HTTP fixtures; no live graph or IdP.
const object = {
  id: "table-employees",
  name: "EMPLOYEES",
  kind: "Table",
  schema: "HR",
  qualifiedName: "HR.EMPLOYEES",
  projectId: "sample",
  owner: null,
  signature: null,
  returnType: null,
  declaration: null,
};
const source = {
  ...object,
  id: "routine-start",
  name: "START",
  kind: "Procedure",
  qualifiedName: "HR.START",
};
const items = Array.from({ length: 26 }, (_, i) => ({
  id: `impact-${i}`,
  distance: 1,
  paths: [],
  dependent: {
    ...source,
    id: `routine-${i}`,
    name: `ROUTINE_${i}`,
    qualifiedName: `HR.ROUTINE_${i}`,
  },
}));
const paths = Array.from({ length: 26 }, (_, i) => ({
  id: `path-${i}`,
  hopCount: 1,
  nodes: [source, object],
  relationships: [
    {
      id: `edge-${i}`,
      relationship: "READS",
      source,
      target: object,
      resolution: "EXACT",
      evidence: null,
    },
  ],
}));

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  let nonce = "";
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        keycloak: {
          url: `${origin}/test-oidc`,
          realm: "test",
          clientId: "test",
        },
        uploadLimits: {
          maxFileBytes: 1000,
          maxFiles: 10,
          maxTotalBytes: 10000,
        },
        plsqlEnabled: true,
        plsqlMaxHops: 50,
      },
    }),
  );
  await page.route("**/test-oidc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth")) {
      nonce = url.searchParams.get("nonce") ?? "";
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.hash = new URLSearchParams({
        state: url.searchParams.get("state")!,
        code: "test-code",
      }).toString();
      await route.fulfill({
        status: 302,
        headers: { location: redirect.toString() },
      });
    } else if (url.pathname.endsWith("/token")) {
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encode({ alg: "none" })}.${encode({
        sub: "pagination-test",
        preferred_username: "Pagination test",
        nonce,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        realm_access: { roles: ["viewer"] },
      })}.test`;
      await route.fulfill({
        json: {
          access_token: token,
          refresh_token: token,
          id_token: token,
          token_type: "Bearer",
          expires_in: 3600,
        },
      });
    } else {
      await route.fulfill({ status: 404 });
    }
  });
  await page.route("**/api/backend/api/v1/plsql/**", async (route) => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split("/").at(-1);
    if (kind === "objects") {
      const q = (url.searchParams.get("q") ?? "").toUpperCase();
      const matches = [object, source].filter((item) => item.name.includes(q));
      await route.fulfill({
        json: { items: matches, count: matches.length, truncated: false },
      });
    } else if (kind === "object") {
      await route.fulfill({
        json: url.searchParams.get("objectId") === source.id ? source : object,
      });
    } else if (kind === "impact" || kind === "paths") {
      // Overview also asks for Impact without an explicit limit.
      const limit = url.searchParams.get("limit");
      expect(
        limit === "25" || (kind === "impact" && limit === null),
      ).toBeTruthy();
      const next = url.searchParams.get("cursor");
      expect(next === null || next === `${kind}-next`).toBeTruthy();
      const rows = kind === "impact" ? items : paths;
      await route.fulfill({
        json: {
          ...(kind === "impact"
            ? {
                object,
                summary: {
                  direct: 26,
                  indirect: 0,
                  packages: 0,
                  tablesModified: 0,
                },
              }
            : {}),
          items: next ? rows.slice(25) : rows.slice(0, 25),
          count: 26,
          truncated: !next,
          nextCursor: next ? null : `${kind}-next`,
        },
      });
    } else {
      await route.fulfill({
        status: 503,
        json: {
          code: "analysis_unavailable",
          message: "Fixture endpoint",
          requestId: "test",
        },
      });
    }
  });
  await page.goto("/plsql");
  await page.getByRole("button", { name: "EMPLOYEES", exact: true }).click();
});

test("paginates Impact and expands the graph with loaded results", async ({
  page,
}) => {
  const initialRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/impact") && url.searchParams.get("limit") === "25"
    );
  });
  await page.getByRole("tab", { name: "Impact", exact: true }).click();
  await initialRequest;
  const report = page.getByRole("region", { name: "Impact analysis" });
  await expect(report.getByText("Showing 25 of 26")).toBeVisible();
  await expect(report.getByLabel("Depth")).toHaveAttribute("max", "50");
  await report.getByRole("button", { name: "Graph", exact: true }).click();
  await report.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(report.getByText("Showing 26 of 26")).toBeVisible();
  await expect(report.getByRole("button", { name: "Load more" })).toHaveCount(
    0,
  );
  await report.getByRole("button", { name: "List", exact: true }).click();
  await expect(report.locator("tbody tr")).toHaveCount(26);
});

test("paginates dependency paths and preserves the selected route", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Paths", exact: true }).click();
  const report = page.getByRole("region", { name: "Dependency paths" });
  await report.getByRole("combobox", { name: "From object" }).fill("START");
  await report.getByRole("option", { name: /HR.START/ }).click();
  await report.getByRole("combobox", { name: "To object" }).fill("EMPLOYEES");
  await report.getByRole("option", { name: /HR.EMPLOYEES/ }).click();
  await report.getByRole("button", { name: "Find paths" }).click();
  await expect(report.getByText("Showing 25 of 26")).toBeVisible();
  await report.locator("tbody tr").first().click();
  await expect(
    report.getByText("Selected path", { exact: true }),
  ).toBeVisible();
  await report.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(report.getByText("Showing 26 of 26")).toBeVisible();
  await expect(report.locator("tbody tr")).toHaveCount(26);
  await expect(
    report.getByText("Selected path", { exact: true }),
  ).toBeVisible();
});
