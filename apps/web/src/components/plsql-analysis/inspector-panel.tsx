"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type {
  PlsqlDependency,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { CopyValueButton } from "./copy-value-button";
import { DependencyPathTrail } from "./dependency-path-trail";
import {
  edgeOccurrences,
  ObjectKindBadge,
  ObjectKindIcon,
  ResolutionBadge,
} from "./plsql-atoms";

export type Inspection =
  | { kind: "object"; object: PlsqlObject }
  | { kind: "edge"; edge: PlsqlDependency }
  | { kind: "path"; path: PlsqlPath };

/**
 * Right-hand Inspector: secondary metadata for whatever the user selected
 * (object, dependency edge, or path). Primary content never lives here.
 * Inspecting something (e.g. a node in a dependency trail) never navigates
 * the primary view on its own; `onOpenObject` is the one deliberate way out
 * of the Inspector, jumping to that object's Overview.
 */
export function InspectorPanel({
  inspection,
  onOpenObject,
  onAnalyzeObject,
}: {
  inspection?: Inspection;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  /** Analyze the shown object's impact (its Impact tab). */
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  if (!inspection) {
    return <p className="p-4 text-sm text-text-secondary">{t("empty")}</p>;
  }
  if (inspection.kind === "object") {
    return (
      <ObjectInspection
        object={inspection.object}
        onOpenObject={onOpenObject}
        onAnalyzeObject={onAnalyzeObject}
      />
    );
  }
  if (inspection.kind === "edge") {
    return (
      <EdgeInspection edge={inspection.edge} onOpenObject={onOpenObject} />
    );
  }
  return <PathInspection path={inspection.path} onOpenObject={onOpenObject} />;
}

function ObjectInspection({
  object,
  onOpenObject,
  onAnalyzeObject,
}: {
  object: PlsqlObject;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  onAnalyzeObject?: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const declaration = object.declaration;
  return (
    <div>
      <header className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("objectDetails")}
        </p>
      </header>
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-selected text-primary">
          <ObjectKindIcon kind={object.kind} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <ObjectLink
            reference={object}
            onOpenObject={onOpenObject}
            className="text-base font-semibold"
          >
            {object.name}
          </ObjectLink>
          <p className="mt-1">
            <ObjectKindBadge kind={object.kind} />
          </p>
        </div>
      </div>
      {(onOpenObject || onAnalyzeObject) && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {onOpenObject && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenObject(object)}
            >
              {t("openObject")}
            </Button>
          )}
          {onAnalyzeObject && (
            <Button
              size="sm"
              variant="outline"
              aria-label={t("analyzeImpactFor", { name: object.name })}
              onClick={() => onAnalyzeObject(object)}
            >
              {t("analyzeImpact")}
            </Button>
          )}
        </div>
      )}
      <section className="space-y-3 border-t px-4 py-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-text-muted">{t("schema")}</dt>
          <dd className="min-w-0 break-words">{object.schema}</dd>
          {object.owner && (
            <>
              <dt className="text-text-muted">{t("package")}</dt>
              <dd className="min-w-0 break-words">{object.owner}</dd>
            </>
          )}
        </dl>
        <div>
          <p className="text-xs text-text-muted">{t("qualifiedName")}</p>
          <div className="mt-1 flex items-start gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <code className="min-w-0 flex-1 break-all text-xs">
              {object.qualifiedName}
            </code>
            <CopyValueButton compact value={object.qualifiedName} />
          </div>
        </div>
      </section>
      {declaration?.path && (
        <section className="border-t px-4 py-3">
          <h3 className="text-xs font-semibold text-text-secondary">
            {t("declaration")}
          </h3>
          <div className="mt-2 flex items-start justify-between gap-3 rounded-md border bg-surface px-2.5 py-1.5 text-xs">
            <span className="min-w-0 break-all text-text-secondary">
              {declaration.path}
            </span>
            {declaration.startLine != null && (
              <span className="shrink-0 font-semibold text-text-primary">
                {t("line", { line: declaration.startLine })}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function EdgeInspection({
  edge,
  onOpenObject,
}: {
  edge: PlsqlDependency;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  const occurrences = edgeOccurrences(edge);
  return (
    <div>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("dependencyEdge")}
        </p>
        <ResolutionBadge resolution={edge.resolution} />
      </header>
      <PathTimeline
        label={t("dependencyEdge")}
        nodes={[edge.source, edge.target]}
        relationships={[edge]}
        onOpenObject={onOpenObject}
      />
      <section className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-text-secondary">
            {t("evidence")}
          </h3>
          {occurrences.length > 1 && (
            <span className="rounded-full bg-selected px-2 py-0.5 text-xs font-medium text-primary">
              {t("occurrences", { count: occurrences.length })}
            </span>
          )}
        </div>
        {occurrences.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">{t("none")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {occurrences.map((occurrence) => (
              <li
                key={`${occurrence.path}:${occurrence.startLine ?? ""}:${occurrence.startOffset ?? ""}`}
                className="flex items-start justify-between gap-3 rounded-md border bg-surface px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 break-all text-text-secondary">
                  {occurrence.path}
                </span>
                {occurrence.startLine != null && (
                  <span className="shrink-0 font-semibold text-text-primary">
                    {t("line", { line: occurrence.startLine })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PathInspection({
  path,
  onOpenObject,
}: {
  path: PlsqlPath;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlDependencies.inspector");
  return (
    <div>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("dependencyPath")}
        </p>
        <span className="rounded-full bg-selected px-2.5 py-0.5 text-xs font-medium text-primary">
          {t("hopCount", { count: path.hopCount })}
        </span>
      </header>
      <PathTimeline
        label={t("fullPath")}
        nodes={path.nodes}
        relationships={path.relationships}
        onOpenObject={onOpenObject}
      />
    </div>
  );
}

/** The path (or single dependency) drawn with the shared timeline, padded for the Inspector. */
function PathTimeline({
  label,
  nodes,
  relationships,
  onOpenObject,
}: {
  label: string;
  nodes: PlsqlObjectReference[];
  relationships: PlsqlDependency[];
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  return (
    <div className="px-4 py-4">
      <DependencyPathTrail
        label={label}
        path={{ nodes, relationships }}
        onOpenObject={onOpenObject}
      />
    </div>
  );
}

/**
 * One object reference, rendered as a link to its Overview when `onOpenObject`
 * is provided, or plain text otherwise. The single place the Inspector lets
 * a user leave the current view.
 */
function ObjectLink({
  reference,
  onOpenObject,
  className,
  children,
}: {
  reference: PlsqlObjectReference;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
  className?: string;
  children: ReactNode;
}) {
  if (!onOpenObject) {
    return (
      <span className={`[overflow-wrap:anywhere] ${className ?? ""}`}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenObject(reference)}
      className={`text-left [overflow-wrap:anywhere] underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
