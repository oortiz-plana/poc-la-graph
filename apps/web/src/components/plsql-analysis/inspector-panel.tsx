"use client";

import type { ReactNode } from "react";
import type {
  PlsqlDependency,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
} from "@/lib/contracts";
import {
  evidenceLocation,
  ObjectKindBadge,
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
}: {
  inspection?: Inspection;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  if (!inspection) {
    return (
      <p className="p-4 text-sm text-text-secondary">
        Select an object, dependency, or path to inspect its details.
      </p>
    );
  }
  if (inspection.kind === "object") {
    return (
      <ObjectInspection
        object={inspection.object}
        onOpenObject={onOpenObject}
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
}: {
  object: PlsqlObject;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  const declaration = object.declaration;
  return (
    <div>
      <header className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Object details
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <ObjectLink
            reference={object}
            onOpenObject={onOpenObject}
            className="text-sm font-semibold"
          >
            {object.name}
          </ObjectLink>
          <ObjectKindBadge kind={object.kind} />
        </p>
      </header>
      <dl className="divide-y">
        <Row label="Schema" value={object.schema} />
        <Row label="Qualified name" value={object.qualifiedName} />
        {object.owner && <Row label="Package" value={object.owner} />}
        {declaration?.path && <Row label="File" value={declaration.path} />}
        {declaration?.startLine != null && (
          <Row label="Start line" value={String(declaration.startLine)} />
        )}
        {declaration?.endOffset != null && (
          <Row label="End offset" value={String(declaration.endOffset)} />
        )}
      </dl>
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
  return (
    <div>
      <header className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Dependency edge
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <ResolutionBadge resolution={edge.resolution} />
        </p>
      </header>
      <dl className="divide-y">
        <ReferenceRow
          label="From"
          reference={edge.source}
          onOpenObject={onOpenObject}
        />
        <Row label="Relationship" value={edge.relationship} />
        <ReferenceRow
          label="To"
          reference={edge.target}
          onOpenObject={onOpenObject}
        />
        <Row
          label="Evidence"
          value={evidenceLocation(edge.evidence) ?? "None"}
        />
      </dl>
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
  const from = path.nodes[0];
  const to = path.nodes[path.nodes.length - 1];
  return (
    <div>
      <header className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Dependency path
        </p>
      </header>
      <dl className="divide-y">
        <ReferenceRow
          label="From"
          reference={from}
          onOpenObject={onOpenObject}
        />
        <ReferenceRow label="To" reference={to} onOpenObject={onOpenObject} />
        <Row
          label="Hops"
          value={path.hopCount === 1 ? "1 hop" : `${path.hopCount} hops`}
        />
      </dl>
      <div className="border-t px-4 py-3">
        <p className="text-xs text-text-muted">Full path</p>
        <ol className="mt-2 space-y-1.5">
          {path.nodes.map((node, index) => (
            <li key={`${node.id}-${index}`} className="break-words text-sm">
              {index > 0 && (
                <span className="text-xs text-text-muted">
                  {path.relationships[index - 1].relationship}
                  {" · "}
                </span>
              )}
              <ObjectLink reference={node} onOpenObject={onOpenObject}>
                {node.qualifiedName}
              </ObjectLink>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

function ReferenceRow({
  label,
  reference,
  onOpenObject,
}: {
  label: string;
  reference: PlsqlObjectReference;
  onOpenObject?: (reference: PlsqlObjectReference) => void;
}) {
  return (
    <div className="px-4 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">
        <ObjectLink reference={reference} onOpenObject={onOpenObject}>
          {reference.qualifiedName}
        </ObjectLink>
      </dd>
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
    return <span className={className}>{children}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpenObject(reference)}
      className={`break-words underline decoration-text-secondary/50 underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
