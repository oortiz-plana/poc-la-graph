import type { ReactNode } from "react";

/**
 * A bar pinned to the top of the scrolling analysis pane, for the totals or
 * filters that must stay in view while a list below is scrolled. The negative
 * margin cancels the pane's own gutter so the bar's background spans it.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-1 bg-background px-1 pb-2 pt-1">
      {children}
    </div>
  );
}
