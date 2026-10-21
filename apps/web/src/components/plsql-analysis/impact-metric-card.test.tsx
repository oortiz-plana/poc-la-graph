import { screen } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/render-with-intl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImpactMetricCard, MetricBar } from "./impact-metric-card";

describe("ImpactMetricCard", () => {
  it("renders the value and label", () => {
    render(
      <ImpactMetricCard
        value={42}
        label="Direct dependents"
        active={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Direct dependents")).toBeInTheDocument();
  });

  it("exposes its selected state through aria-pressed", () => {
    const { rerender } = render(
      <ImpactMetricCard
        value={1}
        label="Callees"
        active={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Callees/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(
      <ImpactMetricCard value={1} label="Callees" active onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Callees/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("is a native button, so click and keyboard activation both select it", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ImpactMetricCard
        value={5}
        label="Readers"
        active={false}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", { name: /Readers/ });
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);

    button.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("groups thousands and shows a dash while the number is unknown", () => {
    render(
      <>
        <ImpactMetricCard
          value={12661}
          label="Indirect"
          active={false}
          onSelect={vi.fn()}
        />
        <ImpactMetricCard
          value={undefined}
          label="Packages"
          active={false}
          onSelect={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText("12,661")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("pins its metrics to the top of the scrolling pane", () => {
    render(
      <MetricBar ariaLabel="Totals" columns="grid-cols-2">
        <ImpactMetricCard
          value={1}
          label="Direct"
          active={false}
          onSelect={vi.fn()}
        />
      </MetricBar>,
    );
    const group = screen.getByRole("group", { name: "Totals" });
    expect(group.parentElement).toHaveClass("sticky", "top-0");
  });
});
