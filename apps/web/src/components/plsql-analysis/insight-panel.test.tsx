import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl as render } from "@/test/render-with-intl";
import { CopyValueButton } from "./copy-value-button";
import { InsightPanel } from "./insight-panel";

function panel(onClose = vi.fn()) {
  return (
    <InsightPanel
      ariaLabel="Why affected"
      title="Why is this affected?"
      subtitle="HR.PKG.RUN"
      closeLabel="Close"
      onClose={onClose}
      actions={<CopyValueButton value="HR.PKG.RUN" />}
      trail={<p>trail</p>}
      evidence={<p>evidence</p>}
    />
  );
}

describe("InsightPanel header actions", () => {
  it("puts the copy button in the header, right before the close button", () => {
    render(panel());
    const region = screen.getByRole("region", { name: "Why affected" });
    const header = region.firstElementChild as HTMLElement;
    const buttons = within(header).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy qualified name",
      "Close",
    ]);
    // Nothing copy-related is left in the body.
    const body = region.lastElementChild as HTMLElement;
    expect(within(body).queryByRole("button")).toBeNull();
  });

  it("copies the value and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Copy qualified name" }),
    );
    expect(writeText).toHaveBeenCalledWith("HR.PKG.RUN");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });
});
