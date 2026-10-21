"use client";

import useSWR from "swr";
import { getPlsqlImpactSummary } from "@/lib/api";
import type { ImpactDirection, ImpactRelationship } from "@/lib/contracts";
import { problemCodeOf } from "./analysis-error";

export type ImpactSummaryQuery = {
  objectId: string;
  direction?: ImpactDirection;
  depth?: number;
  relationship?: ImpactRelationship;
  directOnly?: boolean;
  writesOnly?: boolean;
  /** Bumped by the caller to force a fresh request after a failure. */
  attempt?: number;
};

/**
 * Blast-radius totals for one traversal. They load through their own service,
 * so a slow or failed summary never blocks the rows below it (and the rows
 * never decide what the totals say).
 */
export function useImpactSummary(query: ImpactSummaryQuery) {
  const { data, error, isLoading, mutate } = useSWR(
    { resource: "plsql-impact-summary", ...query },
    async ({ objectId, ...traversal }: ImpactSummaryQuery) => {
      const value = await getPlsqlImpactSummary(objectId, {
        direction: traversal.direction,
        depth: traversal.depth,
        relationship: traversal.relationship,
        directOnly: traversal.directOnly,
        writesOnly: traversal.writesOnly,
      });
      if (!value) throw new Error("The impact summary was not found.");
      return value;
    },
    { revalidateOnFocus: false },
  );
  return {
    summary: data?.summary,
    loading: isLoading,
    errorCode: error ? (problemCodeOf(error) ?? "unknown") : undefined,
    retry: () => void mutate(),
  };
}
