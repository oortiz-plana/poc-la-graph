"use client";

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
 */
export function AnalysisError({
  code,
  onRetry,
}: {
  code?: string;
  onRetry?: () => void;
}) {
  const limitExceeded = code === "analysis_limit_exceeded";
  return (
    <div
      role="alert"
      className="rounded-md border border-error-border bg-error-surface p-4 text-error"
    >
      <p className="text-sm">
        {limitExceeded
          ? "This project is too large to compute this view right now."
          : "Analysis is unavailable"}
      </p>
      {limitExceeded ? (
        <p className="mt-2 text-xs text-text-secondary">
          The analysis backend caps how much data this view may compute, so
          retrying would fail the same way.
        </p>
      ) : (
        onRetry && (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            Retry analysis query
          </Button>
        )
      )}
    </div>
  );
}
