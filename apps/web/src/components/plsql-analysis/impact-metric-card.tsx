"use client";

import { cn } from "@/lib/utils";

/**
 * One clickable summary metric. Same visual language as the read-only
 * `StatCard`, but as a native button so the browser gives Tab/Enter/Space
 * activation for free; `aria-pressed` carries the filter's active state.
 */
export function ImpactMetricCard({
  value,
  label,
  active,
  onSelect,
}: {
  value: number;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "rounded-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active
          ? "border-primary bg-selected"
          : "bg-surface hover:bg-background",
      )}
    >
      <span className="block text-2xl font-semibold">{value}</span>
      <span className="block text-xs text-text-secondary">{label}</span>
    </button>
  );
}
