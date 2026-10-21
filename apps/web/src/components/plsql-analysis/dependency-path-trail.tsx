"use client";

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type {
  PlsqlDependency,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useInspectedObjectId } from "./inspected-object";
import {
  edgeOccurrences,
  EVIDENCE_LINK_CLASS,
  useKindLabel,
  ObjectKindIcon,
  RelationshipChip,
} from "./plsql-atoms";

/** Minimal shape needed to render a chain of nodes joined by relationships. */
export type PathLike = Pick<PlsqlPath, "nodes" | "relationships">;

/** A single dependency edge is a one-hop path, reusing the same trail. */
export function dependencyToPath(edge: PlsqlDependency): PathLike {
  return { nodes: [edge.source, edge.target], relationships: [edge] };
}

/**
 * Vertical timeline shared by every view that explains why two objects are
 * connected: impact's "Why is this affected?" detail, a traced dependency
 * path, a single dependency (a one-hop path) and the Inspector. Numbered
 * stops hang from a rail; the relationship between two stops is written as a
 * sentence ("calls", "writes to", …) next to its technical chip, so the chain
 * reads top to bottom. Node clicks, relationship clicks and per-hop evidence
 * links are opt-in so read-only contexts stay non-interactive.
 */
export function DependencyPathTrail({
  path,
  label,
  highlightedId,
  onOpenObject,
  onOpenEvidence,
  onInspectEdge,
}: {
  path: PathLike;
  /** Accessible name of the list; defaults to "Full path". */
  label?: string;
  highlightedId?: string;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onOpenEvidence?: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const lastIndex = path.nodes.length - 1;
  return (
    <ol aria-label={label ?? t("fullPath")} className="relative">
      <span
        aria-hidden
        className="absolute bottom-5 left-3 top-5 w-px bg-border"
      />
      {path.nodes.map((node, index) => (
        <li key={`${node.id}-${index}`}>
          {index > 0 && (
            <TrailHop
              edge={path.relationships[index - 1]}
              onInspectEdge={onInspectEdge}
              onOpenEvidence={onOpenEvidence}
            />
          )}
          <TrailStop
            node={node}
            number={index + 1}
            role={index === 0 ? "start" : index === lastIndex ? "end" : "step"}
            highlighted={node.id === highlightedId}
            onOpenObject={onOpenObject}
          />
        </li>
      ))}
    </ol>
  );
}

function TrailHop({
  edge,
  onInspectEdge,
  onOpenEvidence,
}: {
  edge: PlsqlDependency;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  onOpenEvidence?: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const chip = <RelationshipChip relationship={edge.relationship} />;
  return (
    <div className="relative flex items-center gap-3 py-2">
      <span
        aria-hidden
        className="relative z-10 flex w-6 shrink-0 justify-center bg-background text-xs leading-none text-text-muted"
      >
        ▼
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-text-secondary">
          {t(`verbs.${edge.relationship}`)}
        </span>
        {onInspectEdge ? (
          <button
            type="button"
            onClick={() => onInspectEdge(edge)}
            className="group rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <RelationshipChip
              relationship={edge.relationship}
              className="group-hover:border-primary group-hover:text-primary"
            />
          </button>
        ) : (
          chip
        )}
        {onOpenEvidence && (
          <PathEvidenceLink edge={edge} onOpenEvidence={onOpenEvidence} />
        )}
      </div>
    </div>
  );
}

function TrailStop({
  node,
  number,
  role,
  highlighted,
  onOpenObject,
}: {
  node: PlsqlObjectReference;
  number: number;
  role: "start" | "step" | "end";
  highlighted: boolean;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const kindLabel = useKindLabel();
  const inspected = useInspectedObjectId() === node.id;
  const context = node.qualifiedName.endsWith(node.name)
    ? node.qualifiedName.slice(0, -node.name.length).replace(/\.$/, "")
    : node.qualifiedName;
  const endpoint = role !== "step";
  const body = (
    <>
      {/* Kind on the left, tags on the right; when the card is too narrow
          for both, the tags drop to their own line instead of squeezing. */}
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ObjectKindIcon kind={node.kind} className="h-3.5 w-3.5 shrink-0" />
          {kindLabel(node.kind)}
        </span>
        {(inspected || endpoint) && (
          <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {inspected && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-primary px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">
                <Eye aria-hidden className="h-3 w-3 shrink-0" />
                {t("inspected")}
              </span>
            )}
            {endpoint && (
              <span className="whitespace-nowrap rounded bg-selected px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
                {role === "start" ? t("from") : t("to")}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="mt-1 block break-words text-sm font-semibold text-text-primary">
        {node.name}
      </span>
      {context && (
        <span className="block break-all text-xs text-text-secondary">
          {context}
        </span>
      )}
    </>
  );
  const cardClass = cn(
    "block min-w-0 flex-1 rounded-lg border px-3 py-2 text-left",
    highlighted
      ? "border-primary bg-selected"
      : cn("bg-surface", endpoint && "border-primary/60"),
    inspected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
  );
  return (
    <div className="relative flex items-start gap-3">
      <span
        aria-label={t("step", { number })}
        className={cn(
          "relative z-10 mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold",
          endpoint || highlighted
            ? "border-primary bg-primary text-white"
            : "bg-surface text-text-secondary",
        )}
      >
        {number}
      </span>
      {onOpenObject ? (
        <button
          type="button"
          aria-label={node.qualifiedName}
          aria-current={inspected ? "true" : undefined}
          title={node.qualifiedName}
          onClick={() => onOpenObject(node)}
          className={cn(
            cardClass,
            "hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          )}
        >
          {body}
        </button>
      ) : (
        <div
          title={node.qualifiedName}
          aria-current={inspected ? "true" : undefined}
          className={cardClass}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function PathEvidenceLink({
  edge,
  onOpenEvidence,
}: {
  edge: PlsqlPath["relationships"][number];
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
}) {
  const t = useTranslations("plsqlOverview");
  const occurrences = edgeOccurrences(edge).filter(
    (occurrence) => occurrence.sourceFileId,
  );
  if (occurrences.length === 0) return null;
  // One link per call site of this hop's object pair, each opening its own line.
  return (
    <>
      {occurrences.length > 1 && (
        <span className="text-xs text-text-secondary">
          {t("occurrences", { count: occurrences.length })}
        </span>
      )}
      {occurrences.map((evidence) => (
        <button
          key={`${evidence.path}:${evidence.startLine ?? ""}:${evidence.startOffset ?? ""}`}
          type="button"
          onClick={() => onOpenEvidence(evidence)}
          className={`max-w-full ${EVIDENCE_LINK_CLASS}`}
        >
          {evidence.path +
            (evidence.startLine == null ? "" : `:${evidence.startLine}`)}
        </button>
      ))}
    </>
  );
}
