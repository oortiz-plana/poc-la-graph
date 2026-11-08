import { screen, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlUsageSummary } from "@/lib/contracts";
import { plsqlUsageSummarySchema } from "@/lib/contracts";
import { UsagePanel } from "./usage-panel";

const getPlsqlUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getPlsqlUsage }));

const reference = {
  id: "plsql://sample/HR/FUNCTION/GET_SALARY",
  kind: "Function" as const,
  name: "GET_SALARY",
  schema: "HR",
  qualifiedName: "HR.PKG_EMP.GET_SALARY",
};

function summary(
  overrides: Partial<PlsqlUsageSummary> = {},
): PlsqlUsageSummary {
  return {
    daysInWindow: 7,
    since: "2026-11-01T00:00:00+00:00",
    until: "2026-11-07T12:00:00+00:00",
    requests: 10,
    distinctUsers: 2,
    errors: 1,
    p50DurationMs: 12,
    p95DurationMs: 48.4,
    operations: [
      {
        operation: "search_objects",
        requests: 6,
        errors: 0,
        p95DurationMs: 30,
      },
      {
        operation: "brand_new_view",
        requests: 4,
        errors: 1,
        p95DurationMs: 48,
      },
    ],
    daily: [
      { day: "2026-11-06", requests: 0 },
      { day: "2026-11-07", requests: 10 },
    ],
    users: [
      {
        username: "alice",
        requests: 7,
        lastActiveAt: "2026-11-07T11:00:00+00:00",
        topOperation: "search_objects",
      },
      {
        username: "bob",
        requests: 3,
        lastActiveAt: "2026-11-06T09:00:00+00:00",
        topOperation: "get_impact",
      },
    ],
    topObjects: [
      { objectId: reference.id, object: reference, requests: 5 },
      { objectId: "plsql://sample/HR/TABLE/GONE", object: null, requests: 2 },
    ],
    truncated: false,
    ...overrides,
  };
}

function renderPanel(onOpenObject = vi.fn()) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <UsagePanel onOpenObject={onOpenObject} />
    </SWRConfig>,
  );
  return onOpenObject;
}

function problem(code: string) {
  return Object.assign(new Error("failed"), { code });
}

describe("UsagePanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows a loading state while the summary is on its way", () => {
    getPlsqlUsage.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(
      screen.getByRole("status", { name: "Loading console usage" }),
    ).toBeInTheDocument();
  });

  it("summarizes requests, people, views and objects", async () => {
    getPlsqlUsage.mockResolvedValue(summary());
    renderPanel();

    expect(await screen.findByText("10%")).toBeInTheDocument();
    // The p95 stat and the slower operation's row.
    expect(screen.getAllByText("48 ms")).toHaveLength(2);
    const people = screen.getByRole("table", { name: "Requests by person" });
    expect(within(people).getByText("alice")).toBeInTheDocument();
    expect(within(people).getByText("Impact report")).toBeInTheDocument();
    const views = screen.getByRole("table", { name: "Requests by view" });
    expect(within(views).getByText("Object search")).toBeInTheDocument();
    // An operation this UI has no label for keeps its route name.
    expect(within(views).getByText("brand_new_view")).toBeInTheDocument();
    expect(
      screen.getByText("An object no longer in the analyzed project"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nov 7: 10 requests")).toBeInTheDocument();
  });

  it("opens a most viewed object", async () => {
    const user = userEvent.setup();
    getPlsqlUsage.mockResolvedValue(summary());
    const onOpenObject = renderPanel();
    await user.click(
      await screen.findByRole("button", { name: reference.qualifiedName }),
    );
    expect(onOpenObject).toHaveBeenCalledWith(reference);
  });

  it("asks for another window", async () => {
    const user = userEvent.setup();
    getPlsqlUsage.mockResolvedValue(summary());
    renderPanel();
    const thirty = await screen.findByRole("button", { name: "30 days" });
    await user.click(thirty);
    expect(getPlsqlUsage).toHaveBeenLastCalledWith(30);
    expect(thirty).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nobody used the console", async () => {
    getPlsqlUsage.mockResolvedValue(
      summary({ requests: 0, users: [], operations: [], topObjects: [] }),
    );
    renderPanel();
    expect(
      await screen.findByText(
        "Nobody has used the console in the last 7 days.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that usage analytics is off", async () => {
    getPlsqlUsage.mockRejectedValue(problem("analysis_not_configured"));
    renderPanel();
    expect(
      await screen.findByText(/Usage analytics is turned off/),
    ).toBeInTheDocument();
  });

  it("offers a retry after a failure", async () => {
    const user = userEvent.setup();
    getPlsqlUsage.mockRejectedValueOnce(problem("analysis_unavailable"));
    getPlsqlUsage.mockResolvedValue(summary());
    renderPanel();
    await user.click(
      await screen.findByRole("button", { name: "Retry analysis query" }),
    );
    expect(await screen.findByText("10%")).toBeInTheDocument();
  });

  it("notes a truncated window", async () => {
    getPlsqlUsage.mockResolvedValue(summary({ truncated: true }));
    renderPanel();
    expect(
      await screen.findByText(/oldest requests are left out/),
    ).toBeInTheDocument();
  });
});

describe("plsqlUsageSummarySchema", () => {
  it("accepts the API payload and rejects an unsupported window", () => {
    expect(plsqlUsageSummarySchema.parse(summary())).toEqual(summary());
    expect(() =>
      plsqlUsageSummarySchema.parse({ ...summary(), daysInWindow: 3 }),
    ).toThrow();
  });
});
