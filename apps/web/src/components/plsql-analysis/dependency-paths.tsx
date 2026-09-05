"use client";

import { LoaderCircle } from "lucide-react";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { findPlsqlPaths, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlPathResult,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { PlsqlObjectCombobox } from "./object-combobox";

type PathStatus = "idle" | "loading" | "ready" | "error";

export function DependencyPathsSection({
  initialFrom,
  onOpenObject,
  onOpenEvidence,
  onInspectPath,
}: {
  initialFrom?: PlsqlObject;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath?: (path: PlsqlPath) => void;
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
      <form onSubmit={(event) => void tracePaths(event)} className="mt-3 max-w-3xl">
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
                  onOpenObject={onOpenObject}
                  onOpenEvidence={onOpenEvidence}
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
  onOpenObject,
  onOpenEvidence,
}: {
  path: PlsqlPath;
  expanded: boolean;
  onToggle: () => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
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
          <p className="text-sm font-semibold text-text-secondary">
            Route
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
            {path.nodes.map((node, index) => (
              <Fragment key={`${node.id}-${index}`}>
                {index > 0 && (
                  <Fragment key={`hop-${index}`}>
                    <span aria-hidden>→</span>
                    <span className="font-medium">
                      {path.relationships[index - 1].relationship}
                    </span>
                    <span aria-hidden>→</span>
                  </Fragment>
                )}
                <button
                  type="button"
                  onClick={() => onOpenObject(node)}
                  className="min-h-11 min-w-0 max-w-full break-words rounded underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {node.qualifiedName}
                </button>
                {index > 0 && (
                  <EvidenceLink
                    edge={path.relationships[index - 1]}
                    onOpenEvidence={onOpenEvidence}
                  />
                )}
              </Fragment>
            ))}
          </p>
        </div>
      )}
    </li>
  );
}

function EvidenceLink({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlPath["relationships"][number];
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const evidence = edge.evidence;
  if (!evidence?.sourceFileId) return null;
  const location =
    evidence.path +
    (evidence.startLine == null ? "" : `:${evidence.startLine}`);
  return (
    <button
      type="button"
      onClick={() => onOpenEvidence(evidence)}
      className="min-h-11 min-w-0 max-w-full break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {location}
    </button>
  );
}
