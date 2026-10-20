"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { Button } from "@/components/ui/button";

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

export function AnalysisPagination({
  loaded,
  total,
  nextCursor,
  loading,
  error,
  onLoadMore,
  onRetry,
}: {
  loaded: number;
  total: number;
  nextCursor: string | null;
  loading: boolean;
  error: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("plsqlWorkspace.pagination");
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-sm text-text-secondary">
        {t("showing", { loaded, total })}
      </p>
      {error && (
        <p role="alert" className="text-sm text-text-secondary">
          {t("loadError")}
        </p>
      )}
      {(error || nextCursor) && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={loading}
          onClick={error ? onRetry : onLoadMore}
        >
          {loading && (
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          )}
          {loading ? t("loading") : error ? t("retry") : t("loadMore")}
        </Button>
      )}
    </div>
  );
}
