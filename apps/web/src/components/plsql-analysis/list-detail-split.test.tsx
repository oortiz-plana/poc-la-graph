import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";

describe("ListDetailSplit", () => {
  it("renders the list alone when nothing is selected", () => {
    render(<ListDetailSplit list={<p>Results</p>} />);

    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
  });

  it("renders the detail next to the list when selected", () => {
    render(<ListDetailSplit list={<p>Results</p>} detail={<p>Detail</p>} />);

    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.getByText("Detail")).toBeInTheDocument();
  });
});

describe("InsightPanel", () => {
  it("shows the title, subtitle, both slots and closes on request", async () => {
    const onClose = vi.fn();
    render(
      <InsightPanel
        ariaLabel="Why CALC is affected"
        title="Why is this affected?"
        subtitle="VU_SFI.CALC"
        closeLabel="Close why CALC is affected"
        onClose={onClose}
        trail={<p>Trail</p>}
        evidence={<p>Evidence</p>}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Why CALC is affected" }),
    ).toBeInTheDocument();
    expect(screen.getByText("VU_SFI.CALC")).toBeInTheDocument();
    expect(screen.getByText("Trail")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Source evidence" }),
    ).toHaveTextContent("Evidence");

    await userEvent.click(
      screen.getByRole("button", { name: "Close why CALC is affected" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
