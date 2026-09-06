import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

function renderShell(hasInspection = true) {
  return render(
    <WorkspaceShell
      explorer={<p>explorer-content</p>}
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
    const main = screen.getByRole("main");
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
    const explorer = screen.getByLabelText("Object Explorer");
    const inspector = screen.getByLabelText("Inspector");
    // The width itself is the CSS var `--sidebar-width`, set on the
    // SidebarProvider ancestor to a clamp() expression rather than hardcoded
    // in the panel's own class list.
    const explorerWidth = explorer
      .closest<HTMLElement>("[style*='--sidebar-width']")
      ?.style.getPropertyValue("--sidebar-width");
    const inspectorWidth = inspector
      .closest<HTMLElement>("[style*='--sidebar-width']")
      ?.style.getPropertyValue("--sidebar-width");
    expect(explorerWidth).toContain("clamp(");
    expect(inspectorWidth).toContain("clamp(");
    expect(screen.getByRole("main").className).toContain("min-w-0");
    expect(screen.getByRole("main").className).toContain("flex-1");
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
        explorer={<input aria-label="Explorer search" />}
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
});
