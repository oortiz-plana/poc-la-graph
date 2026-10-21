import { X } from "lucide-react";
import { useTranslations } from "next-intl";
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
  actions,
  trail,
  evidence,
}: {
  ariaLabel: string;
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  /** Header buttons shown before the close button (e.g. copy the name). */
  actions?: ReactNode;
  trail: ReactNode;
  evidence: ReactNode;
}) {
  const t = useTranslations("plsqlOverview");
  return (
    <section aria-label={ariaLabel} className="rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h4 className="shrink-0 text-sm font-semibold text-text-secondary">
            {title}
          </h4>
          {subtitle && (
            <span title={subtitle} className="truncate text-xs text-text-muted">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-text-secondary hover:bg-selected hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-start">
        <div className="min-w-0 flex-[1_1_16rem] p-4">{trail}</div>
        <section
          aria-label={t("insight.sourceEvidence")}
          className="min-w-0 flex-[2_1_22rem] p-4"
        >
          {evidence}
        </section>
      </div>
    </section>
  );
}
