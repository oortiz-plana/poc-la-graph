"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getPlsqlHealth, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlHealth,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { evidenceLocation, ResolutionBadge } from "./plsql-atoms";

type SectionStatus = "loading" | "ready" | "error";

const CATEGORIES = [
  { key: "unresolved", label: "Unresolved references" },
  { key: "ambiguous", label: "Ambiguous references" },
  { key: "dynamicSql", label: "Dynamic SQL" },
  { key: "parseErrors", label: "Parse errors" },
  { key: "unsupported", label: "Unsupported constructs" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

export function HealthPanel({
  objectId,
  onOpenEvidence,
}: {
  objectId?: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const [repositoryWide, setRepositoryWide] = useState(!objectId);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [health, setHealth] = useState<PlsqlHealth>();
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [openCategory, setOpenCategory] = useState<CategoryKey>("unresolved");

  const scopedId = repositoryWide ? undefined : objectId;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    getPlsqlHealth(scopedId)
      .then((value) => {
        if (!cancelled) {
          setHealth(value);
          setStatus("ready");
        }
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
  }, [scopedId, attempt]);

  return (
    <section aria-label="Analysis health">
      {objectId && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={repositoryWide}
            onChange={(event) => setRepositoryWide(event.target.checked)}
          />
          Show repository-wide diagnostics
        </label>
      )}
      {status === "loading" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading analysis health…
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError
            code={errorCode}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        </div>
      )}
      {status === "ready" && health && (
        <>
          {health.truncated && (
            <p className="mt-2 text-sm text-warning">Results truncated</p>
          )}
          <div role="group" aria-label="Diagnostic category" className="mt-3 flex flex-wrap gap-2">
            {CATEGORIES.map((entry) => {
              const category = health[entry.key];
              const active = entry.key === openCategory;
              return (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOpenCategory(entry.key)}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
                    active
                      ? "border-transparent bg-selected text-primary"
                      : "bg-surface text-text-secondary hover:bg-background"
                  }`}
                >
                  {entry.label}
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs">
                    {category.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              {
                CATEGORIES.find((entry) => entry.key === openCategory)?.label
              }
            </h3>
            {health[openCategory].items.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                No diagnostics in this category
              </p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border bg-surface">
                {health[openCategory].items.map((edge) => (
                  <HealthRow
                    key={edge.id}
                    edge={edge}
                    onOpenEvidence={onOpenEvidence}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {status === "ready" && health && health.total === 0 && (
        <p className="mt-3 flex items-start gap-2 text-sm text-success">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          No diagnostics reported for this scope.
        </p>
      )}
    </section>
  );
}

function HealthRow({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const location = evidenceLocation(edge.evidence);
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1 break-words text-sm">
        {edge.source.qualifiedName}
        <span aria-hidden> → </span>
        <span className="font-medium">{edge.relationship}</span>
        <span aria-hidden> → </span>
        {edge.target.qualifiedName}
      </span>
      <ResolutionBadge resolution={edge.resolution} />
      {location !== undefined && edge.evidence?.sourceFileId ? (
        <button
          type="button"
          onClick={() => onOpenEvidence(edge.evidence)}
          className="min-h-11 min-w-0 max-w-full break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {location}
        </button>
      ) : location !== undefined ? (
        <span className="text-xs text-text-secondary">{location}</span>
      ) : null}
    </li>
  );
}
