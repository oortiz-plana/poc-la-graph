"use client";

import { cn } from "@/lib/utils";
import type {
  PlsqlDependency,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { KIND_LABELS, ObjectKindIcon, RelationshipChip } from "./plsql-atoms";

/** Minimal shape needed to render a chain of nodes joined by relationships. */
export type PathLike = Pick<PlsqlPath, "nodes" | "relationships">;

/** A single dependency edge is a one-hop path, reusing the same trail. */
export function dependencyToPath(edge: PlsqlDependency): PathLike {
  return { nodes: [edge.source, edge.target], relationships: [edge] };
}

/**
 * Vertical node/relationship chain shared by every view that explains why two
 * objects are connected: impact's "Why is this affected?" detail, a traced
 * dependency path, and a single dependency edge rendered as a one-hop path.
 * Node clicks and per-hop evidence links are opt-in so read-only contexts
 * (e.g. impact's summary chain) stay non-interactive.
 */
export function DependencyPathTrail({
  path,
  highlightedId,
  onOpenObject,
  onOpenEvidence,
  onInspectEdge,
  showKind,
}: {
  path: PathLike;
  highlightedId?: string;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onOpenEvidence?: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
  /** Shows each node's kind icon and plain-language label beneath its name.
   * Used where a single relationship is the whole point of the view (the
   * Dependencies inspector); the longer chains elsewhere stay compact. */
  showKind?: boolean;
}) {
  const hasHopDetail = Boolean(onOpenEvidence || onInspectEdge);
  return (
    <ol className="flex flex-col items-center">
      {path.nodes.map((node, index) => (
        <li key={`${node.id}-${index}`} className="flex flex-col items-center">
          {index > 0 && (
            <div
              aria-hidden={!hasHopDetail}
              className="flex flex-col items-center py-1 text-text-muted"
            >
              <span aria-hidden className="h-2.5 w-px bg-border" />
              {onInspectEdge ? (
                <button
                  type="button"
                  onClick={() => onInspectEdge(path.relationships[index - 1])}
                  className="group rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <RelationshipChip
                    relationship={path.relationships[index - 1].relationship}
                    className="group-hover:border-primary group-hover:text-primary"
                  />
                </button>
              ) : (
                <RelationshipChip
                  relationship={path.relationships[index - 1].relationship}
                />
              )}
              <span aria-hidden>▼</span>
              {onOpenEvidence && (
                <PathEvidenceLink
                  edge={path.relationships[index - 1]}
                  onOpenEvidence={onOpenEvidence}
                />
              )}
            </div>
          )}
          <PathNode
            node={node}
            highlighted={node.id === highlightedId}
            onOpenObject={onOpenObject}
            showKind={showKind}
          />
        </li>
      ))}
    </ol>
  );
}

function PathNode({
  node,
  highlighted,
  onOpenObject,
  showKind,
}: {
  node: PlsqlObjectReference;
  highlighted: boolean;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  showKind?: boolean;
}) {
  const chipClass = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-medium",
    highlighted
      ? "border-primary bg-selected text-primary"
      : "bg-surface text-text-primary",
  );
  const inner = (
    <>
      <ObjectKindIcon kind={node.kind} className="h-4 w-4 shrink-0" />
      <span className="break-words">{node.name}</span>
    </>
  );
  return (
    <span className="flex flex-col items-center gap-0.5">
      {onOpenObject ? (
        <button
          type="button"
          title={node.qualifiedName}
          aria-label={node.qualifiedName}
          onClick={() => onOpenObject(node)}
          className={cn(
            chipClass,
            "min-h-9 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          )}
        >
          {inner}
        </button>
      ) : (
        <span title={node.qualifiedName} className={chipClass}>
          {inner}
        </span>
      )}
      {showKind && (
        <span className="text-xs text-text-muted">
          {KIND_LABELS[node.kind]}
        </span>
      )}
    </span>
  );
}

function PathEvidenceLink({
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
      className="min-h-9 max-w-full break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {location}
    </button>
  );
}
