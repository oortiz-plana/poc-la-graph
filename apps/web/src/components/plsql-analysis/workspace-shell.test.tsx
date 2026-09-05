import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

function renderShell() {
  return render(
    <WorkspaceShell
      explorer={<p>explorer-content</p>}
      inspector={<p>inspector-content</p>}
    >
      <p>main-content</p>
    </WorkspaceShell>,
  ).container.firstElementChild as HTMLElement;
}

describe("WorkspaceShell", () => {
  it("renders explorer, main area, and inspector in order", () => {
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
      main.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("labels the contextual panes", () => {
    renderShell();
    expect(screen.getByLabelText("Object Explorer")).toBeInTheDocument();
    expect(screen.getByLabelText("Inspector")).toBeInTheDocument();
  });

  it("opens the Explorer and Inspector drawers from the toolbar", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell
        explorer={<p>explorer-content</p>}
        inspector={<p>inspector-content</p>}
      >
        <p>main-content</p>
      </WorkspaceShell>,
    );
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

  it("collapses the Inspector before the Explorer responsively", () => {
    renderShell();
    const explorer = screen.getByLabelText("Object Explorer");
    const inspector = screen.getByLabelText("Inspector");
    expect(explorer.className).toContain("hidden");
    expect(explorer.className).toContain("md:block");
    expect(inspector.className).toContain("hidden");
    expect(inspector.className).toContain("xl:block");
    expect(screen.getByRole("main").className).toContain("overflow-y-auto");
  });
});
