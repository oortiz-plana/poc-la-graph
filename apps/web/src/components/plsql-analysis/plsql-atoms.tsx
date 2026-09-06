"use client";

import {
  Braces,
  DatabaseZap,
  Eye,
  Package,
  Sigma,
  Table2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  PlsqlObjectKind,
  PlsqlObjectReference,
  PlsqlResolution,
} from "@/lib/contracts";

const KIND_ICONS: Record<PlsqlObjectKind, LucideIcon> = {
  Package: Package,
  Procedure: Braces,
  Function: Sigma,
  Table: Table2,
  View: Eye,
  Trigger: Zap,
  Sequence: DatabaseZap,
  Index: DatabaseZap,
  Synonym: DatabaseZap,
  Type: DatabaseZap,
  AnonymousBlock: DatabaseZap,
};

/** Plain-language label for one object kind, shared wherever a kind is rendered as text. */
export const KIND_LABELS: Record<PlsqlObjectKind, string> = {
  Package: "Package",
  Procedure: "Procedure",
  Function: "Function",
  Table: "Table",
  View: "View",
  Trigger: "Trigger",
  Sequence: "Sequence",
  Index: "Index",
  Synonym: "Synonym",
  Type: "Type",
  AnonymousBlock: "Anonymous block",
};

export function ObjectKindIcon({
  kind,
  className,
}: {
  kind: PlsqlObjectKind;
  className?: string;
}) {
  const Icon = KIND_ICONS[kind];
  return <Icon aria-hidden className={className} />;
}

export function ObjectKindBadge({ kind }: { kind: PlsqlObjectKind }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary">
      {kind}
    </span>
  );
}

const RESOLUTION_LABELS: Record<PlsqlResolution, string> = {
  EXACT: "Resolved",
  INFERRED: "Inferred",
  AMBIGUOUS: "Unresolved",
  UNRESOLVED: "Unresolved",
};

const RESOLUTION_TONES: Record<PlsqlResolution, string> = {
  EXACT: "border-success-border bg-success-surface text-success",
  INFERRED: "border-information-border bg-information-surface text-information",
  AMBIGUOUS: "border-warning-border bg-warning-surface text-warning",
  UNRESOLVED: "border-warning-border bg-warning-surface text-warning",
};

/**
 * Confidence label for one edge. The display uses plain-language terms
 * (Resolved/Inferred/Unresolved) so EXACT never promises guaranteed runtime
 * execution; the precise pipeline value stays available as a tooltip.
 */
export function ResolutionBadge({
  resolution,
}: {
  resolution: PlsqlResolution;
}) {
  return (
    <span
      title={`Confidence: ${resolution}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESOLUTION_TONES[resolution]}`}
    >
      {RESOLUTION_LABELS[resolution]}
    </span>
  );
}

export function evidenceLocation(
  evidence: {
    path?: string | null;
    startLine?: number | null;
  } | null,
): string | undefined {
  if (!evidence?.path) return undefined;
  return evidence.startLine == null
    ? evidence.path
    : `${evidence.path}:${evidence.startLine}`;
}

const ROUTINE_KINDS = new Set<PlsqlObjectKind>(["Procedure", "Function"]);

/** Bare package name (without schema), for a routine reference nested under a package. */
export function displayPackageOf(
  ref: PlsqlObjectReference,
): string | undefined {
  if (ref.kind === "Package") return undefined;
  const segments = ref.qualifiedName.split(".");
  if (ROUTINE_KINDS.has(ref.kind) && segments.length >= 3) {
    return segments.slice(1, -1).join(".");
  }
  return undefined;
}

/** "1 hop" / "N hops" for a traversal distance. */
export function hopText(distance: number): string {
  return distance === 1 ? "1 hop" : `${distance} hops`;
}
