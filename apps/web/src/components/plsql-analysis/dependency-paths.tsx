"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { findPlsqlPaths, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlPathResult,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { DependencyPathTrail } from "./dependency-path-trail";
import { PlsqlObjectCombobox } from "./object-combobox";

type PathStatus = "idle" | "loading" | "ready" | "error";

export function DependencyPathsSection({
  initialFrom,
  onInspectObject,
  onOpenEvidence,
  onInspectPath,
  onInspectEdge,
}: {
  initialFrom?: PlsqlObject;
  /** Route nodes are inspected in place; clicking one must never navigate
   * away or reset the traced route (see the shared onInspectEdge below). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath?: (path: PlsqlPath) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const [from, setFrom] = useState<PlsqlObject>();
  const [to, setTo] = useState<PlsqlObject>();
  const [status, setStatus] = useState<PathStatus>("idle");
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [result, setResult] = useState<PlsqlPathResult>();
  const [expandedId, setExpandedId] = useState<string>();
  const headingId = "plsql-dependency-paths-heading";

  useEffect(() => {
    setFrom(initialFrom);
    setResult(undefined);
    setStatus("idle");
    setExpandedId(undefined);
  }, [initialFrom]);

  const canTrace = Boolean(from && to && from.id !== to.id);

  async function tracePaths(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!from || !to || from.id === to.id) return;
    setStatus("loading");
    setErrorCode(undefined);
    try {
      setResult(await findPlsqlPaths(from.id, to.id));
      setStatus("ready");
    } catch (error) {
      setErrorCode(problemCodeOf(error));
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        Dependency paths
      </h2>
      <form
        onSubmit={(event) => void tracePaths(event)}
        className="mt-3 max-w-3xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <PlsqlObjectCombobox
            id="plsql-path-from"
            label="From object"
            selected={from}
            onSelect={setFrom}
          />
          <PlsqlObjectCombobox
            id="plsql-path-to"
            label="To object"
            selected={to}
            onSelect={setTo}
          />
        </div>
        <Button type="submit" disabled={!canTrace} className="mt-3">
          Find paths
        </Button>
        {!canTrace && (
          <p className="mt-2 text-xs text-text-secondary">
            Choose two different searched objects to trace paths between them.
          </p>
        )}
      </form>

      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Loading dependency paths…
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError code={errorCode} onRetry={() => void tracePaths()} />
        </div>
      )}
      {status === "ready" && result && (
        <div className="mt-3">
          {result.truncated && (
            <p className="text-sm text-warning">Results truncated</p>
          )}
          {result.items.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              No dependency paths found
            </p>
          ) : (
            <ol
              aria-label="Dependency paths between the selected objects"
              className="mt-2 divide-y rounded-lg border bg-surface"
            >
              {result.items.map((path) => (
                <PathRow
                  key={path.id}
                  path={path}
                  expanded={expandedId === path.id}
                  onToggle={() => {
                    onInspectPath?.(path);
                    setExpandedId((current) =>
                      current === path.id ? undefined : path.id,
                    );
                  }}
                  onInspectObject={onInspectObject}
                  onOpenEvidence={onOpenEvidence}
                  onInspectEdge={onInspectEdge}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function PathRow({
  path,
  expanded,
  onToggle,
  onInspectObject,
  onOpenEvidence,
  onInspectEdge,
}: {
  path: PlsqlPath;
  expanded: boolean;
  onToggle: () => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const hopText = path.hopCount === 1 ? "1 hop" : `${path.hopCount} hops`;
  const from = path.nodes[0];
  const to = path.nodes[path.nodes.length - 1];
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-sm hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="min-w-0 break-words font-medium">
          {from.qualifiedName}
        </span>
        <span aria-hidden>→</span>
        <span className="min-w-0 break-words">{to.qualifiedName}</span>
        <span className="text-xs text-text-secondary">{hopText}</span>
      </button>
      {expanded && (
        <div className="border-t px-3 py-3">
          <p className="text-sm font-semibold text-text-secondary">Route</p>
          <div className="mt-1">
            <DependencyPathTrail
              path={path}
              onOpenObject={onInspectObject}
              onOpenEvidence={onOpenEvidence}
              onInspectEdge={onInspectEdge}
            />
          </div>
        </div>
      )}
    </li>
  );
}
