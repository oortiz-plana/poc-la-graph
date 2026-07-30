"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Answer, Citation } from "@/lib/contracts";

export function EvidenceDrawer({
  answer,
  citations,
  onClose,
}: {
  answer?: Answer;
  citations: Citation[];
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const evidence = answer?.graphEvidence;
  const nodeName = new Map(
    evidence?.nodes.map((node) => [node.id, node.label]),
  );
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        hideClose
        side="right"
        aria-labelledby="evidence-heading"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <SheetHeader>
            <SheetDescription className="text-xs font-semibold uppercase tracking-widest text-sky-700">
              Grounding details
            </SheetDescription>
            <SheetTitle
              id="evidence-heading"
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-bold"
            >
              Answer evidence
            </SheetTitle>
          </SheetHeader>
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label="Close evidence"
            className="min-h-11 min-w-11"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <section aria-labelledby="sources-heading" className="mt-7">
          <h3 id="sources-heading" className="text-lg font-semibold">
            Sources ({citations.length})
          </h3>
          {citations.length ? (
            <ol className="mt-3 space-y-3">
              {citations.map((citation, index) => (
                <li
                  key={citation.id}
                  className="rounded-xl border bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>
                      [{index + 1}] {citation.title}
                    </strong>
                    <Badge variant="outline">{citation.provenance}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {citation.source}
                  </p>
                  {citation.excerpt && (
                    <blockquote className="mt-3 border-l-2 border-sky-400 pl-3 text-sm">
                      {citation.excerpt}
                    </blockquote>
                  )}
                  <dl className="mt-2 text-xs text-slate-500">
                    {citation.relationship && (
                      <div>
                        <dt className="inline font-semibold">Relationship: </dt>
                        <dd className="inline">{citation.relationship}</dd>
                      </div>
                    )}
                    {citation.nodeId && (
                      <div>
                        <dt className="inline font-semibold">Node: </dt>
                        <dd className="inline">{citation.nodeId}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No citations were returned for this answer.
            </p>
          )}
        </section>
        <section
          className="mt-8 border-t pt-6"
          aria-labelledby="structure-heading"
        >
          <h3 id="structure-heading" className="text-lg font-semibold">
            Graph structure
          </h3>
          {!evidence ||
          (!evidence.nodes.length &&
            !evidence.edges.length &&
            !evidence.paths.length) ? (
            <p className="mt-2 text-sm text-slate-600">
              No graph structure was returned for this answer.
            </p>
          ) : (
            <div className="mt-3 space-y-5">
              <div>
                <h4 className="font-semibold">
                  Nodes ({evidence.nodes.length})
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {evidence.nodes.map((n) => (
                    <li key={n.id}>
                      <strong>{n.label}</strong>{" "}
                      <span className="text-slate-500">
                        ({n.type}, {n.id})
                      </span>{" "}
                      <Badge variant="outline">{n.provenance}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">
                  Relationships ({evidence.edges.length})
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {evidence.edges.map((e) => (
                    <li key={e.id}>
                      {nodeName.get(e.sourceNodeId) ?? e.sourceNodeId} →{" "}
                      <strong>{e.relationship}</strong> →{" "}
                      {nodeName.get(e.targetNodeId) ?? e.targetNodeId}{" "}
                      <Badge variant="outline">{e.provenance}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">
                  Paths ({evidence.paths.length})
                </h4>
                <ol className="mt-2 space-y-1 text-sm">
                  {evidence.paths.map((p) => (
                    <li key={p.id}>
                      {p.nodeIds
                        .map((id) => nodeName.get(id) ?? id)
                        .join(" → ")}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
