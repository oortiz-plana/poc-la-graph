"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getPlsqlOverview, type PlsqlProblemCode } from "@/lib/api";
import type { PlsqlObjectReference, PlsqlOverview } from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { StatCard } from "./stat-card";

type SectionStatus = "loading" | "ready" | "error";

export function OverviewPanel({
  objectId,
  onOpenObject,
  onExploreDependencies,
}: {
  objectId: string;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onExploreDependencies: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [overview, setOverview] = useState<PlsqlOverview>();
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const headingId = "plsql-overview-heading";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    getPlsqlOverview(objectId)
      .then((value) => {
        if (cancelled) return;
        if (!value) {
          setStatus("error");
          return;
        }
        setOverview(value);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorCode(problemCodeOf(error));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, attempt]);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        Potential impact
      </h2>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading overview…
        </p>
      )}
      {status === "error" && (
        <AnalysisError
          code={errorCode}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      )}
      {status === "ready" && overview && (
        <OverviewBody
          overview={overview}
          onOpenObject={onOpenObject}
          onExploreDependencies={onExploreDependencies}
        />
      )}
    </section>
  );
}

type NumericStatKey =
  | "directDependents"
  | "indirectDependents"
  | "callers"
  | "callees"
  | "tablesAccessed";

const STAT_CARDS: { label: string; key: NumericStatKey }[] = [
  { label: "Direct dependents", key: "directDependents" },
  { label: "Indirect dependents", key: "indirectDependents" },
  { label: "Callers", key: "callers" },
  { label: "Callees", key: "callees" },
  { label: "Tables accessed", key: "tablesAccessed" },
];

function OverviewBody({
  overview,
  onOpenObject,
  onExploreDependencies,
}: {
  overview: PlsqlOverview;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onExploreDependencies: () => void;
}) {
  return (
    <div className="mt-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STAT_CARDS.map((card) => (
          <StatCard key={card.key} value={overview[card.key]} label={card.label} />
        ))}
      </dl>
      <section aria-labelledby="plsql-overview-callers" className="mt-6">
        <h3
          id="plsql-overview-callers"
          className="text-sm font-semibold text-text-secondary"
        >
          Direct callers
        </h3>
        {overview.topCallers.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
            No direct callers
          </p>
        ) : (
          <ul className="mt-2 divide-y rounded-lg border bg-surface">
            {overview.topCallers.map((caller) => (
              <li key={caller.id}>
                <button
                  type="button"
                  onClick={() => onOpenObject(caller)}
                  className="flex min-h-11 w-full flex-wrap items-center gap-x-3 px-3 py-2 text-left hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">
                    {caller.name}
                  </span>
                  <span className="min-w-0 break-words text-xs text-text-secondary">
                    {caller.qualifiedName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {overview.callers > overview.topCallers.length && (
          <p className="mt-2 text-xs text-text-secondary">
            {overview.callers - overview.topCallers.length} more in Dependencies.
          </p>
        )}
        <Button
          variant="outline"
          className="mt-4"
          onClick={onExploreDependencies}
        >
          Explore dependencies <ArrowRight aria-hidden />
        </Button>
      </section>
    </div>
  );
}
