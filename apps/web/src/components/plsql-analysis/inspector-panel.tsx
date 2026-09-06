"use client";

import type {
  PlsqlDependency,
  PlsqlObject,
  PlsqlPath,
} from "@/lib/contracts";
import { evidenceLocation, ObjectKindBadge, ResolutionBadge } from "./plsql-atoms";

export type Inspection =
  | { kind: "object"; object: PlsqlObject }
  | { kind: "edge"; edge: PlsqlDependency }
  | { kind: "path"; path: PlsqlPath };

/**
 * Right-hand Inspector: secondary metadata for whatever the user selected
 * (object, dependency edge, or path). Primary content never lives here.
 */
export function InspectorPanel({ inspection }: { inspection?: Inspection }) {
  if (!inspection) {
    return (
      <p className="p-4 text-sm text-text-secondary">
        Select an object, dependency, or path to inspect its details.
      </p>
    );
  }
  if (inspection.kind === "object") {
    return <ObjectInspection object={inspection.object} />;
  }
  if (inspection.kind === "edge") {
    return <EdgeInspection edge={inspection.edge} />;
  }
  return <PathInspection path={inspection.path} />;
}

function ObjectInspection({ object }: { object: PlsqlObject }) {
  const declaration = object.declaration;
  return (
    <div>
      <header className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Object details
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="break-words text-sm font-semibold">{object.name}</span>
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

function EdgeInspection({ edge }: { edge: PlsqlDependency }) {
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
        <Row label="From" value={edge.source.qualifiedName} />
        <Row label="Relationship" value={edge.relationship} />
        <Row label="To" value={edge.target.qualifiedName} />
        <Row label="Evidence" value={evidenceLocation(edge.evidence) ?? "None"} />
      </dl>
    </div>
  );
}

function PathInspection({ path }: { path: PlsqlPath }) {
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
        <Row label="From" value={from.qualifiedName} />
        <Row label="To" value={to.qualifiedName} />
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
              {node.qualifiedName}
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
