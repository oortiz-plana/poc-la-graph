import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared card for a selected row's explanation: a header (title, optional
 * qualified name, close button) over a trail column and a source-evidence
 * column. The columns wrap by their flex bases, so the card reads as two
 * columns at full width and as a single stack inside a narrow split pane.
 */
export function InsightPanel({
  ariaLabel,
  title,
  subtitle,
  closeLabel,
  onClose,
  trail,
  evidence,
}: {
  ariaLabel: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  trail: ReactNode;
  evidence: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-text-secondary">{title}</h4>
          {subtitle && (
            <span
              title={subtitle}
              className="break-words text-xs text-text-muted"
            >
              {subtitle}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-text-secondary hover:bg-selected hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-start">
        <div className="min-w-0 flex-[1_1_16rem] p-4">{trail}</div>
        <section
          aria-label="Source evidence"
          className="min-w-0 flex-[2_1_22rem] p-4"
        >
          {evidence}
        </section>
      </div>
    </section>
  );
}
