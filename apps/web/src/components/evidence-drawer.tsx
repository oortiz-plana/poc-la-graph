"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { citationPreview, uniqueCitations } from "./cited-answer";

function sourceHeading(citation: Citation) {
  if (!citation.article) return citation.title;
  const article = citation.article.replace(/^art[ií]culo\s+/i, "");
  const paragraph = citation.paragraph
    ? `, literal ${citation.paragraph.replace(/^literal\s+/i, "")}`
    : "";
  return `Artículo ${article}${paragraph}`;
}

function documentLabel(citation: Citation) {
  return citationPreview(citation).split(" · ")[0];
}

function SourceCard({
  citation,
  index,
  selected,
  register,
}: {
  citation: Citation;
  index: number;
  selected: boolean;
  register: (node: HTMLLIElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(selected);
  const isSourcePassage =
    citation.id.startsWith("source:") || Boolean(citation.document);
  useEffect(() => {
    if (selected) setExpanded(true);
  }, [selected]);

  return (
    <li
      ref={register}
      id={`evidence-source-${index + 1}`}
      aria-current={selected ? "true" : undefined}
      className={`scroll-m-4 rounded-xl border p-4 transition ${
        selected
          ? "border-sky-500 bg-sky-50 ring-2 ring-sky-500 ring-offset-2"
          : "bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>
          [{index + 1}] {sourceHeading(citation)}
        </strong>
        <Badge
          variant={citation.provenance === "explicit" ? "secondary" : "outline"}
        >
          {citation.provenance === "explicit"
            ? "Direct evidence"
            : "Extracted evidence"}
        </Badge>
      </div>
      {citation.excerpt && isSourcePassage ? (
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
          className="mt-3 rounded-lg border border-sky-200 bg-white p-3"
        >
          <summary className="cursor-pointer font-semibold text-sky-800 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
            Open full passage
          </summary>
          <blockquote
            className={`mt-3 whitespace-pre-wrap border-l-2 border-sky-400 pl-3 text-sm leading-6 text-slate-800 ${
              selected ? "rounded-r bg-amber-100 py-1 pr-2" : ""
            }`}
          >
            {citation.excerpt}
          </blockquote>
        </details>
      ) : citation.excerpt ? (
        <blockquote
          className={`mt-3 border-l-2 border-sky-400 pl-3 text-sm ${
            selected ? "rounded-r bg-amber-100 py-1 pr-2" : ""
          }`}
        >
          {citation.excerpt}
        </blockquote>
      ) : null}
      <dl className="mt-3 text-xs text-slate-600">
        <div>
          <dt className="sr-only">Source</dt>
          <dd className="font-medium">{documentLabel(citation)}</dd>
        </div>
        {citation.pageNumber && (
          <div>
            <dt className="inline">Page </dt>
            <dd className="inline">{citation.pageNumber}</dd>
          </div>
        )}
        {citation.sectionPath?.length ? (
          <div>
            <dt className="inline">Section </dt>
            <dd className="inline">{citation.sectionPath.join(" › ")}</dd>
          </div>
        ) : null}
        {citation.startLine && citation.endLine && (
          <div>
            <dt className="inline">Lines </dt>
            <dd className="inline">
              {citation.startLine}–{citation.endLine}
            </dd>
          </div>
        )}
      </dl>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
          Technical details
        </summary>
        <dl className="mt-2 break-words rounded-md border bg-white p-3">
          <div>
            <dt className="inline font-semibold">Correlation ID: </dt>
            <dd className="inline font-mono">{citation.id}</dd>
          </div>
          {citation.document && (
            <div>
              <dt className="inline font-semibold">Document: </dt>
              <dd className="inline">{citation.document}</dd>
            </div>
          )}
          {citation.article && (
            <div>
              <dt className="inline font-semibold">Article: </dt>
              <dd className="inline">{citation.article}</dd>
            </div>
          )}
          {citation.paragraph && (
            <div>
              <dt className="inline font-semibold">Paragraph: </dt>
              <dd className="inline">{citation.paragraph}</dd>
            </div>
          )}
          {citation.relationship && (
            <div>
              <dt className="inline font-semibold">Relationship: </dt>
              <dd className="inline">{citation.relationship}</dd>
            </div>
          )}
          {citation.nodeId && (
            <div>
              <dt className="inline font-semibold">Node ID: </dt>
              <dd className="inline font-mono">{citation.nodeId}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-semibold">Provenance: </dt>
            <dd className="inline">{citation.provenance}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function EvidenceContent({
  answer,
  citations,
  selectedCitationId,
  onClose,
  titleRef,
  mode,
}: {
  answer?: Answer;
  citations: Citation[];
  selectedCitationId?: string;
  onClose: () => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  mode: "panel" | "drawer";
}) {
  const evidence = answer?.graphEvidence;
  const nodeName = new Map(
    evidence?.nodes.map((node) => [node.id, node.label]),
  );
  const cardRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!selectedCitationId) return;
    cardRefs.current
      .get(selectedCitationId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedCitationId]);

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <header
        data-testid="evidence-header"
        className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b bg-white px-5 py-5"
      >
        {mode === "drawer" ? (
          <SheetHeader className="min-w-0">
            <SheetDescription className="text-xs font-semibold uppercase tracking-widest text-sky-700">
              Grounding details
            </SheetDescription>
            <SheetTitle
              id="evidence-heading"
              ref={titleRef}
              tabIndex={-1}
              className="break-words text-2xl font-bold"
            >
              Answer evidence
            </SheetTitle>
          </SheetHeader>
        ) : (
          <div className="min-w-0 space-y-2 text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">
              Grounding details
            </p>
            <h2
              id="evidence-heading"
              ref={titleRef}
              tabIndex={-1}
              className="break-words text-2xl font-bold"
            >
              Answer evidence
            </h2>
          </div>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={onClose}
          aria-label="Close evidence"
          className="min-h-11 min-w-11 shrink-0 focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"
        >
          <X aria-hidden className="h-5 w-5" />
        </Button>
      </header>
      <div data-testid="evidence-body" className="px-5 pb-6 pt-6">
        <section aria-labelledby="sources-heading">
          <h3 id="sources-heading" className="text-lg font-semibold">
            Sources ({citations.length})
          </h3>
          {citations.length ? (
            <ol className="mt-3 space-y-3">
              {citations.map((citation, index) => (
                <SourceCard
                  key={citation.id}
                  citation={citation}
                  index={index}
                  selected={citation.id === selectedCitationId}
                  register={(node) => {
                    if (node) cardRefs.current.set(citation.id, node);
                    else cardRefs.current.delete(citation.id);
                  }}
                />
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
                <ul className="mt-2 space-y-2 text-sm">
                  {evidence.nodes.map((node) => (
                    <li
                      key={node.id}
                      className="rounded-md border bg-slate-50 p-2"
                    >
                      <strong>{node.label}</strong>{" "}
                      <span className="text-slate-500">({node.type})</span>{" "}
                      <Badge variant="outline">{node.provenance}</Badge>
                      <details className="mt-1 text-xs text-slate-600">
                        <summary className="cursor-pointer">
                          Technical details
                        </summary>
                        <span className="font-mono">{node.id}</span>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">
                  Relationships ({evidence.edges.length})
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {evidence.edges.map((edge) => (
                    <li key={edge.id}>
                      {nodeName.get(edge.sourceNodeId) ?? "Unknown node"} →{" "}
                      <strong>{edge.relationship}</strong> →{" "}
                      {nodeName.get(edge.targetNodeId) ?? "Unknown node"}{" "}
                      <Badge variant="outline">{edge.provenance}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold">
                  Paths ({evidence.paths.length})
                </h4>
                <ol className="mt-2 space-y-1 text-sm">
                  {evidence.paths.map((path) => (
                    <li key={path.id}>
                      {path.nodeIds
                        .map((id) => nodeName.get(id) ?? "Unknown node")
                        .join(" → ")}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-labelledby="evidence-heading"
      className="h-full min-h-0 w-80 shrink-0 overflow-hidden border-l bg-white lg:w-96 2xl:w-[28rem]"
    >
      {children}
    </aside>
  );
}

export function EvidenceDrawer({
  answer,
  citations,
  selectedCitationId,
  mode = "drawer",
  onClose,
}: {
  answer?: Answer;
  citations: Citation[];
  selectedCitationId?: string;
  mode?: "panel" | "drawer";
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const unique = useMemo(() => uniqueCitations(citations), [citations]);
  const content = (
    <EvidenceContent
      answer={answer}
      citations={unique}
      selectedCitationId={selectedCitationId}
      onClose={onClose}
      titleRef={heading}
      mode={mode}
    />
  );

  if (mode === "panel") return <Panel>{content}</Panel>;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        hideClose
        side="right"
        aria-labelledby="evidence-heading"
        className="w-[min(100%,36rem)] gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}
