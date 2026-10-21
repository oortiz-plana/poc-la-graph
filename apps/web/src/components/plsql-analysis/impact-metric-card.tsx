"use client";

import { useFormatter } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StickyBar } from "./sticky-bar";

/**
 * The row of summary metrics above a results list. It stays pinned to the top
 * of the scrolling pane, so the totals remain in view while the list below
 * is scrolled or paged.
 */
export function MetricBar({
  ariaLabel,
  labelledBy,
  columns,
  children,
}: {
  ariaLabel?: string;
  labelledBy?: string;
  /** Tailwind grid-column classes for the card row. */
  columns: string;
  children: ReactNode;
}) {
  return (
    <StickyBar>
      <div
        role="group"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        className={cn("grid gap-2", columns)}
      >
        {children}
      </div>
    </StickyBar>
  );
}

/**
 * One clickable summary metric: the number beside its label, in a single
 * compact row. A native button, so the browser gives Tab/Enter/Space
 * activation for free; `aria-pressed` carries the filter's active state.
 */
export function ImpactMetricCard({
  value,
  label,
  active,
  onSelect,
}: {
  /** `undefined` while the number is still loading or failed to load. */
  value: number | undefined;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  const format = useFormatter();
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active
          ? "border-primary bg-selected"
          : "bg-surface hover:border-text-muted hover:bg-background",
      )}
    >
      <span className="shrink-0 text-xl font-semibold leading-none tabular-nums">
        {value === undefined
          ? "—"
          : format.number(value, { useGrouping: "always" })}
      </span>
      <span className="line-clamp-2 min-w-0 text-xs leading-tight text-text-secondary">
        {label}
      </span>
    </button>
  );
}
