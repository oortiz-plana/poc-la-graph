import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlsqlObject } from "@/lib/contracts";
import { ObjectExplorer } from "./object-explorer";

const searchPlsqlObjects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ searchPlsqlObjects }));

const base: PlsqlObject = {
  id: "plsql://p/HR/PACKAGE/FA_QFACT_CALC",
  kind: "Package",
  name: "FA_QFACT_CALC",
  schema: "HR",
  qualifiedName: "HR.FA_QFACT_CALC",
  projectId: "sample",
  owner: null,
  signature: null,
  returnType: null,
  declaration: null,
};

const docuFide: PlsqlObject = {
  ...base,
  id: "plsql://p/HR/FUNCTION/DOCU_FIDE",
  kind: "Function",
  name: "DOCU_FIDE",
  qualifiedName: "HR.FA_QFACT_CALC.DOCU_FIDE",
  owner: "FA_QFACT_CALC",
};

const employeeTable: PlsqlObject = {
  ...base,
  id: "plsql://p/HR/TABLE/EMPLOYEE",
  kind: "Table",
  name: "EMPLOYEE",
  qualifiedName: "HR.EMPLOYEE",
};

function newUser() {
  return userEvent.setup();
}

async function settleSearch(
  user: ReturnType<typeof newUser>,
  items: PlsqlObject[],
) {
  searchPlsqlObjects.mockResolvedValueOnce({
    items,
    truncated: false,
    count: items.length,
  });
  await user.type(screen.getByRole("searchbox"), "qf");
  await waitFor(() =>
    expect(searchPlsqlObjects).toHaveBeenCalledWith("qf", {
      kinds: undefined,
      limit: 100,
      offset: 0,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
}

describe("ObjectExplorer", () => {
  afterEach(() => {
    searchPlsqlObjects.mockReset();
  });

  it("shows the search field and kind filters with All active", () => {
    render(<ObjectExplorer onSelect={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("Search packages, routines and tables..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const label of ["Packages", "Routines", "Tables", "Views"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("debounces the search and passes the kind filter", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    await user.click(screen.getByRole("button", { name: "Tables" }));
    await user.type(screen.getByRole("searchbox"), "emp");
    expect(searchPlsqlObjects).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(searchPlsqlObjects).toHaveBeenCalledWith("emp", {
        kinds: ["Table"],
        limit: 100,
        offset: 0,
      }),
    );
  });

  it("groups package members under their package, expanded by default", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, [base, docuFide, employeeTable]);
    const toggle = screen.getByRole("button", {
      name: "Collapse package FA_QFACT_CALC",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "FA_QFACT_CALC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "DOCU_FIDE" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "EMPLOYEE" }),
    ).toBeInTheDocument();
  });

  it("collapses and expands a package without losing the selection", async () => {
    const user = newUser();
    const onSelect = vi.fn();
    render(<ObjectExplorer selectedId={docuFide.id} onSelect={onSelect} />);
    await settleSearch(user, [base, docuFide]);
    expect(
      screen.getByRole("button", { name: "DOCU_FIDE" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Collapse package FA_QFACT_CALC" }),
    );
    expect(
      screen.queryByRole("button", { name: "DOCU_FIDE" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand package FA_QFACT_CALC" }),
    ).toHaveAttribute("aria-expanded", "false");

    await user.click(
      screen.getByRole("button", { name: "Expand package FA_QFACT_CALC" }),
    );
    expect(
      screen.getByRole("button", { name: "DOCU_FIDE" }),
    ).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("expands or collapses every package at once, enabling only what can change", async () => {
    const user = newUser();
    const otherPackage: PlsqlObject = {
      ...base,
      id: "plsql://p/HR/PACKAGE/AD_QUTIL",
      name: "AD_QUTIL",
      qualifiedName: "HR.AD_QUTIL",
    };
    const otherMember: PlsqlObject = {
      ...docuFide,
      id: "plsql://p/HR/FUNCTION/ARMA_LIN_COL",
      name: "ARMA_LIN_COL",
      qualifiedName: "HR.AD_QUTIL.ARMA_LIN_COL",
      owner: "AD_QUTIL",
    };
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, [base, docuFide, otherPackage, otherMember]);
    const expandAll = screen.getByRole("button", { name: "Expand all" });
    const collapseAll = screen.getByRole("button", { name: "Collapse all" });
    // Everything starts open: only "Collapse all" has anything to do.
    expect(expandAll).toBeDisabled();
    expect(collapseAll).toBeEnabled();

    await user.click(collapseAll);
    expect(screen.queryByRole("button", { name: "DOCU_FIDE" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ARMA_LIN_COL" })).toBeNull();
    expect(collapseAll).toBeDisabled();
    expect(expandAll).toBeEnabled();

    // A single package can still be opened by hand.
    await user.click(
      screen.getByRole("button", { name: "Expand package AD_QUTIL" }),
    );
    expect(
      screen.getByRole("button", { name: "ARMA_LIN_COL" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DOCU_FIDE" })).toBeNull();
    expect(collapseAll).toBeEnabled();

    await user.click(expandAll);
    expect(
      screen.getByRole("button", { name: "DOCU_FIDE" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ARMA_LIN_COL" }),
    ).toBeInTheDocument();
  });

  it("offers no expand/collapse controls when no package is listed", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, [employeeTable]);
    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();
  });

  it("forgets the search, filter and collapsed packages when told to reset", async () => {
    const user = newUser();
    const { rerender } = render(
      <ObjectExplorer onSelect={vi.fn()} resetSignal={0} />,
    );
    await settleSearch(user, [base, docuFide]);
    await user.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getByRole("searchbox")).toHaveValue("qf");

    searchPlsqlObjects.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    rerender(<ObjectExplorer onSelect={vi.fn()} resetSignal={1} />);

    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks the selected object and reports selection", async () => {
    const user = newUser();
    const onSelect = vi.fn();
    render(<ObjectExplorer selectedId={docuFide.id} onSelect={onSelect} />);
    await settleSearch(user, [docuFide]);
    const row = screen.getByRole("button", { name: "DOCU_FIDE" });
    expect(row).toHaveAttribute("aria-current", "true");
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(docuFide);
  });

  it("renders an empty state without matches", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, []);
    expect(screen.getByText("No objects match")).toBeInTheDocument();
  });

  it("pages through matches with the compact navigator", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockImplementation(
      async (_query: string, options: { offset?: number }) => ({
        items: [options.offset ? docuFide : employeeTable],
        truncated: !options.offset,
        count: 250,
      }),
    );
    await user.type(screen.getByRole("searchbox"), "qf");
    expect(await screen.findByText("Showing 1–100 of 250")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByText("Showing 101–200 of 250"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(searchPlsqlObjects).toHaveBeenLastCalledWith("qf", {
        kinds: undefined,
        limit: 100,
        offset: 100,
      }),
    );

    // A new search starts again from the first page.
    await user.type(screen.getByRole("searchbox"), "x");
    await waitFor(() =>
      expect(searchPlsqlObjects).toHaveBeenLastCalledWith("qfx", {
        kinds: undefined,
        limit: 100,
        offset: 0,
      }),
    );
  });

  it("offers no page controls when everything fits on one page", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, [employeeTable]);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("renders the shared error panel and retries on demand", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockRejectedValueOnce({ code: "analysis_unavailable" });
    searchPlsqlObjects.mockResolvedValueOnce({
      items: [],
      truncated: false,
      count: 0,
    });
    await user.type(screen.getByRole("searchbox"), "qf");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("unavailable"),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry analysis query" }),
    );
    await waitFor(() => expect(searchPlsqlObjects).toHaveBeenCalledTimes(2));
  });

  it("exposes trigger and other kinds behind the More filter", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Triggers" }));
    await waitFor(() =>
      expect(searchPlsqlObjects).toHaveBeenCalledWith("", {
        kinds: ["Trigger"],
        limit: 100,
        offset: 0,
      }),
    );
    expect(screen.getByRole("button", { name: "Triggers" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the Synonyms filter disabled because search never returns synonyms", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockResolvedValue({
      items: [],
      truncated: false,
      count: 0,
    });
    await user.click(screen.getByRole("button", { name: "More" }));
    const synonyms = screen.getByRole("menuitem", { name: /Synonyms/ });
    expect(synonyms).toHaveAttribute("aria-disabled", "true");
    expect(synonyms).toHaveTextContent("not searchable");
    await user.click(synonyms);
    expect(searchPlsqlObjects).not.toHaveBeenCalledWith("", {
      kinds: ["Synonym"],
      limit: 100,
      offset: 0,
    });
  });

  it("keeps a single Tab stop in the results and moves with the arrow keys", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    await settleSearch(user, [base, docuFide, employeeTable]);
    const results = screen.getByRole("list", { name: "Object search results" });
    const stops = () =>
      within(results)
        .getAllByRole("button")
        .filter((button) => button.tabIndex === 0);
    expect(stops()).toHaveLength(1);

    const buttons = within(results).getAllByRole("button");
    const packageButton = within(results).getByRole("button", {
      name: "FA_QFACT_CALC",
    });
    packageButton.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      buttons[buttons.indexOf(packageButton) + 1],
    );
    expect(stops()).toEqual([document.activeElement]);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(buttons.at(-1));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("makes the selected object the Tab stop when nothing has focus yet", async () => {
    const user = newUser();
    render(<ObjectExplorer selectedId={employeeTable.id} onSelect={vi.fn()} />);
    await settleSearch(user, [base, docuFide, employeeTable]);
    const results = screen.getByRole("list", { name: "Object search results" });
    const selected = within(results).getByRole("button", { name: /EMPLOYEE/ });
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected.tabIndex).toBe(0);
  });

  it("keeps packages and standalone objects in the server's alphabetical order", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    const alpha = {
      ...employeeTable,
      id: "t-a",
      name: "ALPHA_T",
      qualifiedName: "HR.ALPHA_T",
    };
    const zeta = {
      ...employeeTable,
      id: "t-z",
      name: "ZETA_T",
      qualifiedName: "HR.ZETA_T",
    };
    await settleSearch(user, [alpha, base, docuFide, zeta]);

    const labels = within(
      screen.getByRole("list", { name: "Object search results" }),
    )
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels.indexOf("ALPHA_T")).toBeLessThan(
      labels.indexOf("FA_QFACT_CALC"),
    );
    expect(labels.indexOf("FA_QFACT_CALC")).toBeLessThan(
      labels.indexOf("ZETA_T"),
    );
  });
});
