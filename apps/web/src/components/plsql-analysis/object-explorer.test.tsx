import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows an actionable message when results are truncated", async () => {
    const user = newUser();
    render(<ObjectExplorer onSelect={vi.fn()} />);
    searchPlsqlObjects.mockResolvedValueOnce({
      items: [employeeTable],
      truncated: true,
      count: 1,
    });
    await user.type(screen.getByRole("searchbox"), "qf");
    await waitFor(() =>
      expect(screen.getByText("Showing first 100 results")).toBeInTheDocument(),
    );
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
});
