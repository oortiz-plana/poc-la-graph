import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl as render } from "@/test/render-with-intl";
import type { PlsqlSourceCoordinate } from "@/lib/contracts";
import {
  edgeOccurrences,
  occurrenceCountOf,
  occurrencesTitle,
  OccurrencePicker,
  useEvidenceCellLabel,
  type EdgeOccurrences,
} from "./plsql-atoms";

const at = (startLine: number): PlsqlSourceCoordinate => ({
  sourceFileId: "file://f",
  path: "hr/a.pkb",
  startLine,
  startColumn: 1,
  startOffset: startLine,
  endOffset: startLine + 1,
});

function Label({ edge }: { edge: EdgeOccurrences | null }) {
  const label = useEvidenceCellLabel();
  return <p>{label(edge) ?? "none"}</p>;
}

describe("edge occurrences", () => {
  it("falls back to the single evidence when no occurrence list is present", () => {
    expect(edgeOccurrences({ evidence: at(5) })).toEqual([at(5)]);
    expect(edgeOccurrences({ evidence: null })).toEqual([]);
    expect(edgeOccurrences(undefined)).toEqual([]);
    expect(occurrenceCountOf({ evidence: at(5) })).toBe(1);
    expect(occurrenceCountOf(undefined)).toBe(1);
  });

  it("counts every listed call site and titles them one per line", () => {
    const edge = {
      evidence: at(10),
      occurrences: [at(10), at(20)],
      occurrenceCount: 2,
    };
    expect(occurrenceCountOf(edge)).toBe(2);
    expect(occurrencesTitle(edge)).toBe("hr/a.pkb:10\nhr/a.pkb:20");
  });
});

describe("useEvidenceCellLabel", () => {
  it("keeps the plain line label for one call site", () => {
    render(<Label edge={{ evidence: at(16) }} />);
    expect(screen.getByText("line 16")).toBeInTheDocument();
  });

  it("states how many times and on which lines for repeated call sites", () => {
    render(
      <Label
        edge={{
          evidence: at(1104),
          occurrences: [at(1104), at(1180)],
          occurrenceCount: 2,
        }}
      />,
    );
    expect(screen.getByText("2 times · lines 1104, 1180")).toBeInTheDocument();
  });

  it("caps the listed lines and says how many more there are", () => {
    const lines = [1, 2, 3, 4, 5, 6, 7, 8];
    render(
      <Label
        edge={{
          evidence: at(1),
          occurrences: lines.map(at),
          occurrenceCount: 8,
        }}
      />,
    );
    expect(
      screen.getByText("8 times · lines 1, 2, 3, 4, 5, 6 +2 more"),
    ).toBeInTheDocument();
  });
});

describe("OccurrencePicker", () => {
  it("renders nothing for a single occurrence", () => {
    const { container } = render(
      <OccurrencePicker
        occurrences={[at(3)]}
        activeIndex={0}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the chosen occurrence", async () => {
    const onChange = vi.fn();
    render(
      <OccurrencePicker
        occurrences={[at(3), at(9)]}
        activeIndex={0}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "line 9" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
