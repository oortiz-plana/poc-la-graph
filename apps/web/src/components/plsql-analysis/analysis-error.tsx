"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Extract the backend Problem code from a rejected analysis call. The API
 * client throws `PlsqlApiError` with the parsed code, but call sites keep the
 * check structural so mocked rejections in tests need no class import.
 */
export function problemCodeOf(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Shared error panel for analysis queries. `analysis_limit_exceeded` is
 * deterministic for the current project size (the backend cap is the cause),
 * so no retry is offered; every other code keeps the transient treatment.
 * `context` only changes the `analysis_limit_exceeded` copy: the graph-view
 * cap ("too large to compute") doesn't describe why reading a *source file*
 * failed, which is a byte-size cap on that one file instead (see the source
 * viewer's use of `context="source"`).
 */
export function AnalysisError({
  code,
  onRetry,
  context = "analysis",
}: {
  code?: string;
  onRetry?: () => void;
  context?: "analysis" | "source";
}) {
  const t = useTranslations("plsqlWorkspace.error");
  const limitExceeded = code === "analysis_limit_exceeded";
  if (code === "analysis_not_found") {
    // Nothing failed: the thing asked for simply is not there (for example a
    // source file this environment does not hold), so no alarm and no retry.
    return (
      <p
        role="status"
        className="rounded-md border border-dashed p-4 text-sm text-text-secondary"
      >
        {context === "source" ? t("sourceNotFound") : t("notFound")}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-error-border bg-error-surface p-4 text-error"
    >
      <p className="text-sm">
        {limitExceeded
          ? context === "source"
            ? t("sourceTooLarge")
            : t("analysisTooLarge")
          : t("unavailable")}
      </p>
      {limitExceeded ? (
        <p className="mt-2 text-xs text-text-secondary">
          {context === "source"
            ? t("sourceLimitDetail")
            : t("analysisLimitDetail")}
        </p>
      ) : (
        onRetry && (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            {t("retry")}
          </Button>
        )
      )}
    </div>
  );
}
