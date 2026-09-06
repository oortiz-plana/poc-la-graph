import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DependencyDetailTable,
  type DetailTableColumn,
} from "./dependency-detail-table";

type Row = { id: string; name: string; note: string };

const rows: Row[] = [
  { id: "a", name: "ALPHA", note: "first" },
  { id: "b", name: "BETA", note: "second" },
  { id: "c", name: "GAMMA", note: "third" },
];

const columns: DetailTableColumn<Row>[] = [
  { header: "Object", cell: (row) => row.name },
  { header: "Note", cell: (row) => row.note },
];

function renderTable(
  overrides: {
    rows?: Row[];
    selectedId?: string;
    onSelectRow?: (row: Row) => void;
  } = {},
) {
  const onSelectRow = overrides.onSelectRow ?? vi.fn();
  render(
    <DependencyDetailTable
      ariaLabel="Direct dependents"
      columns={columns}
      rows={overrides.rows ?? rows}
      getRowId={(row) => row.id}
      selectedId={overrides.selectedId}
      onSelectRow={onSelectRow}
      emptyMessage="No rows"
    />,
  );
  return { onSelectRow };
}

describe("DependencyDetailTable", () => {
  it("renders a compact table with the given columns and rows", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Direct dependents" });
    expect(
      screen.getByRole("columnheader", { name: "Object" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Note" }),
    ).toBeInTheDocument();
    expect(table).toHaveTextContent("ALPHA");
    expect(table).toHaveTextContent("second");
  });

  it("shows the empty message when there are no rows", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("selects a row on click", async () => {
    const { onSelectRow } = renderTable();
    await userEvent.click(screen.getByText("BETA"));
    expect(onSelectRow).toHaveBeenCalledWith(rows[1]);
  });

  it("marks the selected row via aria-selected", () => {
    renderTable({ selectedId: "b" });
    const betaRow = screen.getByText("BETA").closest("tr");
    expect(betaRow).toHaveAttribute("aria-selected", "true");
    const alphaRow = screen.getByText("ALPHA").closest("tr");
    expect(alphaRow).toHaveAttribute("aria-selected", "false");
  });

  it("supports arrow-key navigation between rows", async () => {
    const { onSelectRow } = renderTable();
    const user = userEvent.setup();
    const alphaRow = screen.getByText("ALPHA").closest("tr") as HTMLElement;
    alphaRow.focus();
    await user.keyboard("{ArrowDown}");
    expect(onSelectRow).toHaveBeenCalledWith(rows[1]);
    expect(screen.getByText("BETA").closest("tr")).toHaveFocus();
  });

  it("selects the focused row on Enter", async () => {
    const { onSelectRow } = renderTable();
    const user = userEvent.setup();
    const gammaRow = screen.getByText("GAMMA").closest("tr") as HTMLElement;
    gammaRow.focus();
    await user.keyboard("{Enter}");
    expect(onSelectRow).toHaveBeenCalledWith(rows[2]);
  });
});
