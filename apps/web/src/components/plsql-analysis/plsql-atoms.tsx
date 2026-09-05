"use client";

import {
  DatabaseZap,
  Eye,
  Package,
  SquareFunction,
  Table2,
  type LucideIcon,
} from "lucide-react";
import type { PlsqlObjectKind, PlsqlResolution } from "@/lib/contracts";

const KIND_ICONS: Record<PlsqlObjectKind, LucideIcon> = {
  Package: Package,
  Procedure: SquareFunction,
  Function: SquareFunction,
  Table: Table2,
  View: Eye,
  Trigger: DatabaseZap,
  Sequence: DatabaseZap,
  Index: DatabaseZap,
  Synonym: DatabaseZap,
  Type: DatabaseZap,
  AnonymousBlock: SquareFunction,
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
export function ResolutionBadge({ resolution }: { resolution: PlsqlResolution }) {
  return (
    <span
      title={`Confidence: ${resolution}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESOLUTION_TONES[resolution]}`}
    >
      {RESOLUTION_LABELS[resolution]}
    </span>
  );
}


export function evidenceLocation(evidence: {
  path?: string | null;
  startLine?: number | null;
} | null): string | undefined {
  if (!evidence?.path) return undefined;
  return evidence.startLine == null
    ? evidence.path
    : `${evidence.path}:${evidence.startLine}`;
}
