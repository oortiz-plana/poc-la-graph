import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lays a results list beside its selected-row detail when the pane is wide
 * enough and stacks them (list first) when it is not. Wrapping is driven by
 * the flex bases below rather than viewport breakpoints because the docked
 * Object Explorer and Inspector make the pane width independent of the
 * viewport. Side by side needs roughly 60rem of pane.
 */
export function ListDetailSplit({
  list,
  detail,
  stickyTop = "top-0",
}: {
  list: ReactNode;
  detail?: ReactNode;
  /** Tailwind `top-*` class the detail pins to; leave room for a sticky bar above it. */
  stickyTop?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[3_1_34rem]">{list}</div>
      {detail && (
        <div className={cn("sticky min-w-0 flex-[2_1_26rem]", stickyTop)}>
          {detail}
        </div>
      )}
    </div>
  );
}
