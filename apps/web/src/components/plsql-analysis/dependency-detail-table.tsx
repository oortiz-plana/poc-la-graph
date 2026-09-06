"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DetailTableColumn<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
};

/**
 * Compact, scan-friendly table shared by every Overview metric's detail
 * section. Column definitions are supplied by the caller (see
 * `overview-metrics.ts`), so this component knows nothing about dependency
 * or impact data shapes, only how to lay out and navigate rows.
 */
export function DependencyDetailTable<T>({
  ariaLabel,
  columns,
  rows,
  getRowId,
  selectedId,
  onSelectRow,
  emptyMessage,
}: {
  ariaLabel: string;
  columns: DetailTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectedId?: string;
  onSelectRow: (row: T) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-surface">
      <table aria-label={ariaLabel} className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-secondary">
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={cn(
                  "px-3 py-2 font-medium",
                  column.align === "right" && "text-right",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const rowId = getRowId(row);
            return (
              <DetailTableRow
                key={rowId}
                rowId={rowId}
                columns={columns}
                row={row}
                selected={rowId === selectedId}
                onSelect={() => onSelectRow(row)}
                onSelectId={(id) => {
                  const target = rows.find(
                    (candidate) => getRowId(candidate) === id,
                  );
                  if (target) onSelectRow(target);
                }}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailTableRow<T>({
  rowId,
  row,
  columns,
  selected,
  onSelect,
  onSelectId,
}: {
  rowId: string;
  row: T;
  columns: DetailTableColumn<T>[];
  selected: boolean;
  onSelect: () => void;
  onSelectId: (id: string) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
      return;
    }
    const siblingRows = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLTableRowElement>(
        "tr",
      ) ?? [],
    );
    const current = siblingRows.indexOf(event.currentTarget);
    let next = -1;
    if (event.key === "ArrowDown")
      next = Math.min(current + 1, siblingRows.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = siblingRows.length - 1;
    else return;
    event.preventDefault();
    const target = siblingRows[next];
    target?.focus();
    const targetId = target?.getAttribute("data-row-id");
    if (targetId) onSelectId(targetId);
  }

  return (
    <tr
      data-row-id={rowId}
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
        selected ? "bg-selected" : "hover:bg-background",
      )}
    >
      {columns.map((column, index) => (
        <td
          key={index}
          className={cn(
            "px-3 py-1.5 align-middle",
            column.align === "right" && "text-right",
          )}
        >
          {column.cell(row)}
        </td>
      ))}
    </tr>
  );
}
