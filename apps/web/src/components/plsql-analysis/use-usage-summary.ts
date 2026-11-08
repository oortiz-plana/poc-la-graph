"use client";

import useSWR from "swr";
import { getPlsqlUsage } from "@/lib/api";
import type { PlsqlUsageWindow } from "@/lib/contracts";
import { problemCodeOf } from "./analysis-error";

/** Console usage for one window; `attempt` forces a fresh request on retry. */
export function useUsageSummary(days: PlsqlUsageWindow, attempt: number) {
  const { data, error, isLoading } = useSWR(
    { resource: "plsql-usage", days, attempt },
    () => getPlsqlUsage(days),
  );
  return {
    summary: data,
    isLoading,
    errorCode: error ? (problemCodeOf(error) ?? "unknown") : undefined,
  };
}
