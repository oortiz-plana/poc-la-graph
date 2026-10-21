"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { pageWindow } from "@/lib/page-window";
import { cn } from "@/lib/utils";

export const ANALYSIS_PAGE_SIZE = 25;

/** Keep analysis pages local to this mounted report and its authenticated view. */
export function AnalysisPaginationScope({ children }: { children: ReactNode }) {
  const [config] = useState(() => ({
    provider: () => new Map(),
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  }));
  return <SWRConfig value={config}>{children}</SWRConfig>;
}

/**
 * Page navigation for a list read one page at a time: the visible range, a
 * previous/next pair and numbered pages (first, last and the current one's
 * neighbours). `page` is 0-based; the rows shown always belong to it, so a
 * stale page keeps showing (dimmed through `loading`) until the next arrives.
 */
export function AnalysisPageNavigator({
  page,
  pageSize,
  total,
  loading,
  error,
  onPageChange,
  onRetry,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  error: boolean;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("plsqlWorkspace.pagination");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav
      aria-label={t("navigation")}
      className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 border-t bg-surface px-3 py-2"
    >
      <p aria-live="polite" className="text-sm text-text-secondary">
        {t("range", { from, to, total })}
      </p>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-error">
          {t("loadPageError")}
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("retryPage")}
          </Button>
        </p>
      )}
      {pageCount > 1 && (
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={page === 0 || loading}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft aria-hidden className="h-4 w-4" />
              {t("previous")}
            </Button>
          </li>
          {pageWindow(page, pageCount).map((slot) =>
            typeof slot === "number" ? (
              <li key={slot}>
                <Button
                  type="button"
                  variant={slot === page ? "default" : "outline"}
                  className={cn("min-h-11 min-w-11 px-3")}
                  disabled={loading && slot !== page}
                  aria-current={slot === page ? "page" : undefined}
                  aria-label={
                    slot === page
                      ? t("page", { page: slot + 1 })
                      : t("goToPage", { page: slot + 1 })
                  }
                  onClick={() => slot !== page && onPageChange(slot)}
                >
                  {slot + 1}
                </Button>
              </li>
            ) : (
              <li
                key={slot}
                aria-label={t("gap")}
                className="px-1 text-text-muted"
              >
                …
              </li>
            ),
          )}
          <li>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={page >= pageCount - 1 || loading}
              onClick={() => onPageChange(page + 1)}
            >
              {t("next")}
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          </li>
        </ul>
      )}
      {loading && (
        <LoaderCircle
          aria-hidden
          className="h-4 w-4 animate-spin text-text-secondary"
        />
      )}
    </nav>
  );
}

/**
 * Space-saving page navigation for narrow panes (the object explorer): the
 * visible range and a previous/next pair. `page` is 0-based.
 */
export function CompactPageNavigator({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslations("plsqlWorkspace.pagination");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav
      aria-label={t("navigation")}
      className="flex items-center justify-between gap-2"
    >
      <p
        aria-live="polite"
        title={t("pageOf", { page: page + 1, count: pageCount })}
        className="min-w-0 truncate text-xs text-text-secondary"
      >
        {t("range", { from, to, total })}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {loading && (
          <LoaderCircle
            aria-hidden
            className="h-3.5 w-3.5 animate-spin text-text-secondary"
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={t("previous")}
          title={t("previous")}
          disabled={page === 0 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={t("next")}
          title={t("next")}
          disabled={page >= pageCount - 1 || loading}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
