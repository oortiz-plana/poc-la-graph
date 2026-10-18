import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

function renderShell(hasInspection = true) {
  return render(
    <WorkspaceShell
      explorer={() => <p>explorer-content</p>}
      inspector={<p>inspector-content</p>}
      hasInspection={hasInspection}
    >
      <p>main-content</p>
    </WorkspaceShell>,
  ).container.firstElementChild as HTMLElement;
}

/** The SidebarProvider ancestor that carries the `--sidebar-width` CSS var
 * and the Sidebar's own wrapper that carries `data-state`. */
function collapsibleAncestor(pane: HTMLElement): HTMLElement {
  const ancestor = pane.closest<HTMLElement>("[data-state]");
  if (!ancestor) throw new Error("No [data-state] ancestor found");
  return ancestor;
}

describe("WorkspaceShell", () => {
  it("renders explorer, main area, and inspector in order when something is selected", () => {
    renderShell();
    const explorer = screen.getByLabelText("Object Explorer");
    const main = screen.getByRole("region", { name: "Analysis workspace" });
    const inspector = screen.getByLabelText("Inspector");
    expect(screen.getByText("explorer-content")).toBeInTheDocument();
    expect(screen.getByText("main-content")).toBeInTheDocument();
    expect(screen.getByText("inspector-content")).toBeInTheDocument();
    expect(
      explorer.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      main.compareDocumentPosition(inspector) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not render the Inspector pane or its toggles when nothing is selected", () => {
    renderShell(false);
    expect(screen.queryByLabelText("Inspector")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Inspector/ }),
    ).not.toBeInTheDocument();
  });

  it("uses a clamped, flexible width rather than a fixed panel width", () => {
    renderShell();
    expect(screen.getByLabelText("Object Explorer").style.width).toContain(
      "clamp(",
    );
    expect(screen.getByLabelText("Inspector").style.width).toContain("clamp(");
    const workspace = screen.getByRole("region", {
      name: "Analysis workspace",
    });
    expect(workspace.className).toContain("min-w-0");
    expect(workspace.className).toContain("flex-1");
  });

  it("collapses the Explorer docked pane without unmounting it", async () => {
    const user = userEvent.setup();
    renderShell();
    const explorer = screen.getByLabelText("Object Explorer");
    expect(collapsibleAncestor(explorer)).toHaveAttribute(
      "data-state",
      "expanded",
    );
    await user.click(
      screen.getByRole("button", { name: "Hide Object Explorer" }),
    );
    expect(
      collapsibleAncestor(screen.getByLabelText("Object Explorer")),
    ).toHaveAttribute("data-state", "collapsed");
    // Still mounted: its content survives the collapse.
    expect(screen.getByText("explorer-content")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Show Object Explorer" }),
    );
    expect(
      collapsibleAncestor(screen.getByLabelText("Object Explorer")),
    ).toHaveAttribute("data-state", "expanded");
  });

  it("collapses the Inspector docked pane independently of the Explorer", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Hide Inspector" }));
    expect(
      collapsibleAncestor(screen.getByLabelText("Inspector")),
    ).toHaveAttribute("data-state", "collapsed");
    expect(
      collapsibleAncestor(screen.getByLabelText("Object Explorer")),
    ).toHaveAttribute("data-state", "expanded");
    await user.click(screen.getByRole("button", { name: "Show Inspector" }));
    expect(
      collapsibleAncestor(screen.getByLabelText("Inspector")),
    ).toHaveAttribute("data-state", "expanded");
  });

  it("opens the Explorer and Inspector drawers from the toolbar", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Objects" }));
    expect(
      screen.getByRole("dialog", { name: "Object Explorer" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect(
      screen.getByRole("dialog", { name: "Inspector" }),
    ).toBeInTheDocument();
  });

  it("preserves Explorer state across closing and reopening its drawer", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell
        explorer={() => <input aria-label="Explorer search" />}
        inspector={<p>inspector-content</p>}
        hasInspection={false}
      >
        <p>main-content</p>
      </WorkspaceShell>,
    );
    await user.click(screen.getByRole("button", { name: "Objects" }));
    // Scoped to the open drawer: a hidden (CSS-only) docked copy also exists
    // in the DOM, since the drawer's content stays mounted once opened.
    const drawerInput = within(
      screen.getByRole("dialog", { name: "Object Explorer" }),
    ).getByLabelText("Explorer search");
    await user.type(drawerInput, "fa_qfact");
    await user.keyboard("{Escape}");
    // The input itself never unmounted (kept alive via forceMount), so its
    // value survives the close, even though the dialog role goes away.
    expect(drawerInput).toHaveValue("fa_qfact");
    await user.click(screen.getByRole("button", { name: "Objects" }));
    expect(drawerInput).toHaveValue("fa_qfact");
  });

  it("keeps application-navigation-style borders as the only visual boundary", () => {
    renderShell();
    expect(screen.getByLabelText("Object Explorer").className).toContain(
      "border-r",
    );
    expect(screen.getByLabelText("Inspector").className).toContain("border-l");
  });

  it("docks the Explorer from lg and the Inspector from xl", () => {
    renderShell();
    expect(screen.getByLabelText("Object Explorer").className).toContain(
      "lg:block",
    );
    expect(screen.getByLabelText("Inspector").className).toContain("xl:block");
    expect(screen.getByRole("button", { name: "Objects" }).className).toContain(
      "lg:hidden",
    );
    expect(
      screen.getByRole("button", { name: "Inspector" }).className,
    ).toContain("xl:hidden");
  });

  it("offers a skip link past the Explorer to the analysis workspace", () => {
    renderShell();
    const skip = screen.getByRole("link", {
      name: "Skip to analysis workspace",
    });
    expect(skip).toHaveAttribute("href", "#plsql-workspace");
    expect(
      screen.getByRole("region", { name: "Analysis workspace" }),
    ).toHaveAttribute("id", "plsql-workspace");
  });

  it("shows a visible drawer title that leaves room for the close button", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Objects" }));
    const drawer = screen.getByRole("dialog", { name: "Object Explorer" });
    const title = within(drawer).getByText("Object Explorer");
    expect(title.className).not.toContain("sr-only");
    expect(title.parentElement?.className).toContain("pr-16");
  });

  it("returns focus to the Objects button when the drawer is dismissed", async () => {
    const user = userEvent.setup();
    renderShell();
    const objects = screen.getByRole("button", { name: "Objects" });
    await user.click(objects);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(objects).toHaveFocus());
  });

  it("closes the drawer when the Explorer reports a selection", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell
        explorer={({ closeDrawer }) => (
          <button type="button" onClick={closeDrawer}>
            pick-object
          </button>
        )}
        inspector={<p>inspector-content</p>}
        hasInspection={false}
      >
        <p>main-content</p>
      </WorkspaceShell>,
    );
    await user.click(screen.getByRole("button", { name: "Objects" }));
    const drawer = screen.getByRole("dialog", { name: "Object Explorer" });
    await user.click(
      within(drawer).getByRole("button", { name: "pick-object" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Object Explorer" }),
    ).not.toBeInTheDocument();
  });

  it("lets the main area open the Explorer when it is not docked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell
        explorer={() => <input aria-label="Explorer search" type="search" />}
        inspector={<p>inspector-content</p>}
        hasInspection={false}
      >
        {({ openExplorer }) => (
          <button type="button" onClick={openExplorer}>
            browse
          </button>
        )}
      </WorkspaceShell>,
    );
    await user.click(screen.getByRole("button", { name: "browse" }));
    expect(
      screen.getByRole("dialog", { name: "Object Explorer" }),
    ).toBeInTheDocument();
  });
});
