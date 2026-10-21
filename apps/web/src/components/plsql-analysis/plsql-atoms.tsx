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
import { useTranslations } from "next-intl";
import type {
  PlsqlObjectKind,
  PlsqlObjectReference,
  PlsqlResolution,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { cn } from "@/lib/utils";

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

/** Plain-language, localized label for one object kind. */
export function useKindLabel(): (kind: PlsqlObjectKind) => string {
  const t = useTranslations("plsqlOverview");
  return (kind) => t(`kinds.${kind}`);
}

export function ObjectKindBadge({ kind }: { kind: PlsqlObjectKind }) {
  const kindLabel = useKindLabel();
  return (
    <span className="inline-flex items-center rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary">
      {kindLabel(kind)}
    </span>
  );
}

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
  const t = useTranslations("plsqlOverview");
  return (
    <span
      title={t("resolution.confidence", { resolution })}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${RESOLUTION_TONES[resolution]}`}
    >
      {t(`resolution.${resolution}`)}
    </span>
  );
}

/**
 * Compact label for one relationship type (CALLS, READS, WRITES, …), shared
 * wherever a relationship connects two nodes: the Dependencies list and
 * selected-dependency trail, Impact's "why is this affected" trail, traced
 * Paths, and the Inspector's edge/path detail. A plain chip reads better at a
 * glance than underlined link text, which implies navigation it doesn't do.
 */
export function RelationshipChip({
  relationship,
  className = "",
}: {
  relationship: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary ${className}`}
    >
      {relationship}
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

/**
 * Style of an inline evidence link ("line 11", "hr/pkg.pkb:40"). The invisible
 * pseudo-element enlarges the touch target to roughly 44px without changing
 * how dense the surrounding table rows look.
 */
export const EVIDENCE_LINK_CLASS =
  "relative break-words text-xs text-text-secondary underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']";

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

/** Localized "1 hop" / "N hops" for a traversal distance. */
export function useHopText(): (distance: number) => string {
  const t = useTranslations("plsqlOverview");
  return (distance) => t("hop", { count: distance });
}

/** The evidence-bearing part of a dependency edge. */
export type EdgeOccurrences = {
  evidence?: PlsqlSourceCoordinate | null;
  occurrences?: PlsqlSourceCoordinate[];
  occurrenceCount?: number;
};

/** Every source location of an edge (the first is its `evidence`); empty when it has none. */
export function edgeOccurrences(
  edge: EdgeOccurrences | null | undefined,
): PlsqlSourceCoordinate[] {
  if (!edge) return [];
  if (edge.occurrences?.length) return edge.occurrences;
  return edge.evidence ? [edge.evidence] : [];
}

/** Locations of every occurrence for a tooltip, one per line. */
export function occurrencesTitle(
  edge: EdgeOccurrences | null | undefined,
): string | undefined {
  const locations = edgeOccurrences(edge)
    .map((occurrence) => evidenceLocation(occurrence))
    .filter((location): location is string => location !== undefined);
  return locations.length > 0 ? locations.join("\n") : undefined;
}

/** How many call sites an edge stands for (always at least one). */
export function occurrenceCountOf(
  edge: EdgeOccurrences | null | undefined,
): number {
  return Math.max(edge?.occurrenceCount ?? 1, edgeOccurrences(edge).length, 1);
}

const MAX_LISTED_LINES = 6;

/**
 * Evidence cell label: "line 12" for a single call site, "2 times · lines 12,
 * 40" when the same object pair is referenced on several lines.
 */
export function useEvidenceCellLabel(): (
  edge: EdgeOccurrences | null | undefined,
) => string | undefined {
  const t = useTranslations("plsqlOverview");
  const lineLabel = useEvidenceLineLabel();
  return (edge) => {
    const occurrences = edgeOccurrences(edge);
    const count = occurrenceCountOf(edge);
    if (count < 2) return lineLabel(occurrences[0] ?? null);
    const lines = occurrences
      .map((occurrence) => occurrence.startLine)
      .filter((line): line is number => line != null);
    const times = t("occurrences", { count });
    if (lines.length === 0) return times;
    const shown = lines.slice(0, MAX_LISTED_LINES).join(", ");
    const more =
      lines.length > MAX_LISTED_LINES
        ? ` ${t("occurrenceMore", { count: lines.length - MAX_LISTED_LINES })}`
        : "";
    return `${times} · ${t("occurrenceLines", { count: lines.length, lines: shown })}${more}`;
  };
}

/**
 * The Object column of every results table. Beside a detail pane the table is
 * narrow, so `compact` folds the package and kind columns into a second line
 * under the name instead of letting the table scroll sideways.
 */
export function ObjectCell({
  reference,
  compact,
}: {
  reference: PlsqlObjectReference;
  compact: boolean;
}) {
  const kindLabel = useKindLabel();
  const name = (
    <span
      title={reference.qualifiedName}
      className="break-words font-medium [overflow-wrap:anywhere]"
    >
      {reference.name}
    </span>
  );
  if (!compact) return name;
  const pkg = displayPackageOf(reference);
  return (
    <span className="block min-w-0">
      {name}
      <span
        title={pkg ? `${kindLabel(reference.kind)} · ${pkg}` : undefined}
        className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <ObjectKindIcon kind={reference.kind} className="h-3 w-3 shrink-0" />
        <span className="truncate">{pkg ?? kindLabel(reference.kind)}</span>
      </span>
    </span>
  );
}

/** Package column cell: the bare package name on one clipped line (full name on hover), or a dash. */
export function PackageCell({
  reference,
}: {
  reference: PlsqlObjectReference;
}) {
  const name = displayPackageOf(reference);
  if (name === undefined) return <span className="text-text-muted">—</span>;
  return (
    <span title={name} className="block max-w-[12rem] truncate">
      {name}
    </span>
  );
}

/**
 * The Evidence column of every dependency/impact table: one line, clipped with
 * the full list of call sites in the tooltip, so rows keep the same height
 * however many times a pair is referenced. An edge with source coordinates
 * links to its evidence; otherwise the label is plain text.
 */
export function EvidenceCell({
  edge,
  onSelect,
}: {
  edge:
    | (EdgeOccurrences & { evidence?: PlsqlSourceCoordinate | null })
    | null
    | undefined;
  onSelect: () => void;
}) {
  const label = useEvidenceCellLabel()(edge);
  if (label === undefined) return <span className="text-text-muted">—</span>;
  const title = occurrencesTitle(edge);
  if (!edge?.evidence?.sourceFileId) {
    return (
      <span
        title={title}
        className="block max-w-[13rem] truncate text-xs text-text-secondary"
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={`inline-block max-w-[13rem] text-left ${EVIDENCE_LINK_CLASS}`}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

/**
 * Chooses which call site of a multiply-referenced dependency the source
 * panel shows. Renders nothing for a single occurrence.
 */
export function OccurrencePicker({
  occurrences,
  activeIndex,
  onChange,
}: {
  occurrences: PlsqlSourceCoordinate[];
  activeIndex: number;
  onChange: (index: number) => void;
}) {
  const t = useTranslations("plsqlOverview");
  if (occurrences.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={t("occurrenceGroup")}
      className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary"
    >
      <span className="font-medium text-text-primary">
        {t("occurrences", { count: occurrences.length })}
      </span>
      {occurrences.map((occurrence, index) => (
        <button
          key={`${occurrence.path ?? ""}:${occurrence.startLine ?? index}:${occurrence.startOffset ?? ""}`}
          type="button"
          aria-pressed={index === activeIndex}
          title={evidenceLocation(occurrence)}
          onClick={() => onChange(index)}
          className={cn(
            "min-h-8 rounded-md border px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            index === activeIndex
              ? "border-primary bg-selected text-text-primary"
              : "bg-surface hover:bg-background",
          )}
        >
          {occurrence.startLine != null
            ? t("line", { line: occurrence.startLine })
            : (occurrence.path ?? String(index + 1))}
        </button>
      ))}
    </div>
  );
}

/** Localized counterpart of `evidenceLineLabel`. */
export function useEvidenceLineLabel(): (
  evidence: { path?: string | null; startLine?: number | null } | null,
) => string | undefined {
  const t = useTranslations("plsqlOverview");
  return (evidence) =>
    evidence?.startLine != null
      ? t("line", { line: evidence.startLine })
      : (evidence?.path ?? undefined);
}
