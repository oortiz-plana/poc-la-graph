"use client";

import { Fragment, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlsqlImpact } from "@/lib/api";
import type {
  PlsqlImpactResult,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlRelationship,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";

type SectionStatus = "loading" | "ready" | "error";

type TableOnPaths = {
  ref: PlsqlObjectReference;
  relationships: PlsqlRelationship[];
};

export function ImpactReport({
  objectId,
  onOpenEvidence,
}: {
  objectId: string;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [result, setResult] = useState<PlsqlImpactResult>();
  const headingId = "plsql-impact-heading";

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getPlsqlImpact(objectId)
      .then((value) => {
        if (cancelled) return;
        if (!value) {
          setStatus("error");
          return;
        }
        setResult(value);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, attempt]);

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-semibold">
        Impact analysis
      </h3>
      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading impact analysis…
        </p>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-error-border bg-error-surface p-4 text-error"
        >
          <p className="text-sm">Analysis is unavailable</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Retry analysis query
          </Button>
        </div>
      )}
      {status === "ready" && result && (
        <ImpactBody result={result} onOpenEvidence={onOpenEvidence} />
      )}
    </section>
  );
}

function ImpactBody({
  result,
  onOpenEvidence,
}: {
  result: PlsqlImpactResult;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  if (result.items.length === 0) {
    return (
      <>
        {result.truncated && (
          <p className="text-sm text-warning">Results truncated</p>
        )}
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          No impacted dependents
        </p>
      </>
    );
  }

  const direct = result.items.filter((item) => item.distance === 1);
  const inTransit = result.items.filter((item) => item.distance > 1);
  const tables = tablesOnPaths(result.items);
  const tableWord = tables.length === 1 ? "table" : "tables";

  return (
    <>
      {result.truncated && (
        <p className="text-sm text-warning">Results truncated</p>
      )}
      <p className="mt-2 text-sm text-text-secondary">
        Impact scope for {result.object.qualifiedName}: {result.count}{" "}
        dependents — {direct.length} direct, {inTransit.length} in-transit,{" "}
        {tables.length} {tableWord} read or written on the paths below.
      </p>
      {direct.length > 0 && (
        <ImpactGroup
          title="Direct dependents"
          items={direct}
          onOpenEvidence={onOpenEvidence}
        />
      )}
      {inTransit.length > 0 && (
        <ImpactGroup
          title="In-transit dependents"
          items={inTransit}
          onOpenEvidence={onOpenEvidence}
        />
      )}
      {tables.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-text-secondary">
            Tables read or modified on paths
          </h4>
          <ul className="mt-2 divide-y rounded-lg border bg-surface">
            {tables.map((table) => (
              <li
                key={table.ref.id}
                className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 break-words">
                  {table.ref.qualifiedName}
                </span>
                <span className="text-xs text-text-secondary">
                  {table.relationships.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ImpactGroup({
  title,
  items,
  onOpenEvidence,
}: {
  title: string;
  items: PlsqlImpactResult["items"];
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold text-text-secondary">{title}</h4>
      <ul className="mt-2 divide-y rounded-lg border bg-surface">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
          >
            <span className="min-w-0 flex-1 break-words text-sm font-medium">
              {item.dependent.qualifiedName}
            </span>
            <span className="text-xs text-text-secondary">
              {item.distance === 1 ? "1 hop" : `${item.distance} hops`}
            </span>
          </li>
        ))}
      </ul>
      {items.map((item) => (
        <ul
          key={`paths-${item.id}`}
          aria-label={`Explaining paths for ${item.dependent.qualifiedName}`}
          className="mt-2"
        >
          {item.paths.map((path) => (
            <li key={path.id}>
              <PathEvidence path={path} onOpenEvidence={onOpenEvidence} />
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

function PathEvidence({
  path,
  onOpenEvidence,
}: {
  path: PlsqlPath;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const finalEvidence =
    path.relationships[path.relationships.length - 1]?.evidence;
  const location = finalEvidence?.path
    ? finalEvidence.startLine == null
      ? finalEvidence.path
      : `${finalEvidence.path}:${finalEvidence.startLine}`
    : undefined;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
      {path.nodes.map((node, index) => (
        <Fragment key={`${node.id}-${index}`}>
          {index > 0 && (
            <>
              <span aria-hidden>→</span>
              <span className="font-medium">
                {path.relationships[index - 1].relationship}
              </span>
              <span aria-hidden>→</span>
            </>
          )}
          <span className="break-words">{node.qualifiedName}</span>
        </Fragment>
      ))}
      {location !== undefined && finalEvidence?.sourceFileId && (
        <button
          type="button"
          onClick={() => onOpenEvidence(finalEvidence)}
          className="min-h-11 min-w-0 break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {location}
        </button>
      )}
    </p>
  );
}

function tablesOnPaths(items: PlsqlImpactResult["items"]): TableOnPaths[] {
  const byId = new Map<
    string,
    { ref: PlsqlObjectReference; relationships: Set<PlsqlRelationship> }
  >();
  for (const item of items) {
    for (const path of item.paths) {
      for (const relationship of path.relationships) {
        if (
          relationship.relationship !== "READS" &&
          relationship.relationship !== "WRITES"
        ) {
          continue;
        }
        const existing = byId.get(relationship.target.id);
        if (existing) {
          existing.relationships.add(relationship.relationship);
        } else {
          byId.set(relationship.target.id, {
            ref: relationship.target,
            relationships: new Set([relationship.relationship]),
          });
        }
      }
    }
  }
  return [...byId.values()]
    .map((entry) => ({
      ref: entry.ref,
      relationships: [...entry.relationships].sort(),
    }))
    .sort((a, b) => a.ref.qualifiedName.localeCompare(b.ref.qualifiedName));
}
