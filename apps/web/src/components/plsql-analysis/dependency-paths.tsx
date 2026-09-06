"use client";

import { Copy, LoaderCircle } from "lucide-react";
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
import {
  DependencyDetailTable,
  type DetailTableColumn,
} from "./dependency-detail-table";
import { DependencyPathTrail } from "./dependency-path-trail";
import { PlsqlObjectCombobox } from "./object-combobox";
import { evidenceLineLabel, hopText } from "./plsql-atoms";
import { SourceBody } from "./source-viewer";

type PathStatus = "idle" | "loading" | "ready" | "error";

/** One compact result row: a whole traced route between the chosen objects. */
type PathListRow = { id: string; path: PlsqlPath };

export function DependencyPathsSection({
  initialFrom,
  onInspectObject,
  onOpenEvidence,
  onInspectPath,
  onInspectEdge,
  onOpenObject,
  onAnalyzeObject,
}: {
  initialFrom?: PlsqlObject;
  /** Route nodes are inspected in place; clicking one must never navigate
   * away or reset the traced route (see the shared onInspectEdge below). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath?: (path: PlsqlPath) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
}) {
  const [from, setFrom] = useState<PlsqlObject>();
  const [to, setTo] = useState<PlsqlObject>();
  const [status, setStatus] = useState<PathStatus>("idle");
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [result, setResult] = useState<PlsqlPathResult>();
  const [selectedId, setSelectedId] = useState<string>();
  const headingId = "plsql-dependency-paths-heading";

  useEffect(() => {
    setFrom(initialFrom);
    setResult(undefined);
    setStatus("idle");
    setSelectedId(undefined);
  }, [initialFrom]);

  const canTrace = Boolean(from && to && from.id !== to.id);

  async function tracePaths(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!from || !to || from.id === to.id) return;
    setStatus("loading");
    setErrorCode(undefined);
    try {
      setResult(await findPlsqlPaths(from.id, to.id));
      setSelectedId(undefined);
      setStatus("ready");
    } catch (error) {
      setErrorCode(problemCodeOf(error));
      setStatus("error");
    }
  }

  function selectPath(path: PlsqlPath) {
    onInspectPath?.(path);
    setSelectedId((current) => (current === path.id ? undefined : path.id));
  }

  const rows: PathListRow[] = (result?.items ?? []).map((path) => ({
    id: path.id,
    path,
  }));
  const columns: DetailTableColumn<PathListRow>[] = [
    {
      header: "Route",
      cell: (row) => (
        <span
          title={row.path.nodes.map((node) => node.qualifiedName).join(" → ")}
          className="break-words font-medium"
        >
          {row.path.nodes.map((node) => node.name).join(" → ")}
        </span>
      ),
    },
    {
      header: "Hops",
      align: "right",
      cell: (row) => hopText(row.path.hopCount),
    },
  ];
  const selected = result?.items.find((path) => path.id === selectedId);

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
            <p className="mb-2 text-sm text-warning">Results truncated</p>
          )}
          <DependencyDetailTable
            ariaLabel="Dependency paths between the selected objects"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            selectedId={selectedId}
            onSelectRow={(row) => selectPath(row.path)}
            emptyMessage="No dependency paths found"
          />
          {selected && (
            <SelectedPath
              path={selected}
              onClose={() => setSelectedId(undefined)}
              onInspectObject={onInspectObject}
              onOpenEvidence={onOpenEvidence}
              onInspectEdge={onInspectEdge}
              onOpenObject={onOpenObject}
              onAnalyzeObject={onAnalyzeObject}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SelectedPath({
  path,
  onClose,
  onInspectObject,
  onOpenEvidence,
  onInspectEdge,
  onOpenObject,
  onAnalyzeObject,
}: {
  path: PlsqlPath;
  onClose: () => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
}) {
  const destination = path.nodes[path.nodes.length - 1];
  const finalEdge = path.relationships[path.relationships.length - 1];
  const lineLabel = evidenceLineLabel(finalEdge?.evidence);
  const [copied, setCopied] = useState(false);

  async function copyQualifiedName() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(destination.qualifiedName);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label="Selected path" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-secondary">
          Selected path
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded px-2 text-sm underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Close
        </button>
      </div>
      <div className="mt-2 grid items-start gap-4 lg:grid-cols-[35%_1fr]">
        <div className="rounded-lg border bg-surface p-4">
          <DependencyPathTrail
            path={path}
            onOpenObject={onInspectObject}
            onOpenEvidence={onOpenEvidence}
            onInspectEdge={onInspectEdge}
            showKind
          />
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">
              {hopText(path.hopCount)}
            </span>
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onOpenObject && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenObject(destination)}
              >
                Open object
              </Button>
            )}
            {onAnalyzeObject && (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Analyze impact for ${destination.name}`}
                onClick={() => onAnalyzeObject(destination)}
              >
                Analyze impact
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyQualifiedName()}
            >
              <Copy aria-hidden /> {copied ? "Copied" : "Copy qualified name"}
            </Button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? "Qualified name copied to clipboard." : ""}
          </p>
        </div>
        <section aria-label="Source evidence" className="min-w-0">
          {finalEdge?.evidence?.sourceFileId ? (
            <SourceBody
              heading="Source evidence"
              onOpenFullSource={() => onOpenEvidence(finalEdge.evidence)}
              request={{
                kind: "file",
                fileId: finalEdge.evidence.sourceFileId,
                startLine: finalEdge.evidence.startLine ?? undefined,
                endLine: finalEdge.evidence.startLine ?? undefined,
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              No source evidence available for this path.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
