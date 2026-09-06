"use client";

import { cn } from "@/lib/utils";
import type {
  PlsqlDependency,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { RelationshipChip } from "./plsql-atoms";

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
}: {
  path: PathLike;
  highlightedId?: string;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onOpenEvidence?: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
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
}: {
  node: PlsqlObjectReference;
  highlighted: boolean;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  const chipClass = cn(
    "inline-flex max-w-full items-center rounded-md border px-3 py-1 text-sm font-medium",
    highlighted
      ? "border-primary bg-selected text-primary"
      : "bg-surface text-text-primary",
  );
  if (!onOpenObject) {
    return (
      <span title={node.qualifiedName} className={chipClass}>
        <span className="break-words">{node.name}</span>
      </span>
    );
  }
  return (
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
      <span className="break-words">{node.name}</span>
    </button>
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
