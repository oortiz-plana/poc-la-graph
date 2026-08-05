"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Citation } from "@/lib/contracts";

export function uniqueCitations(citations: Citation[]): Citation[] {
  return [
    ...new Map(citations.map((citation) => [citation.id, citation])).values(),
  ];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function citationMarkdown(text: string, citations: Citation[]) {
  const unique = uniqueCitations(citations);
  let rendered = text.replace(/\[(\d+)\](?!\()/g, (match, rawNumber) => {
    const number = Number(rawNumber);
    return number > 0 && number <= unique.length
      ? `[${number}](#citation-${number})`
      : match;
  });

  [...unique]
    .map((citation, index) => ({ citation, number: index + 1 }))
    .sort((left, right) => right.citation.id.length - left.citation.id.length)
    .forEach(({ citation, number }) => {
      const escaped = escapeRegExp(citation.id);
      rendered = rendered.replace(
        new RegExp(`(?:\\[${escaped}\\]|\\(${escaped}\\)|${escaped})`, "g"),
        `[${number}](#citation-${number})`,
      );
    });

  // Provider correlation IDs are never meaningful to a reader. A token that
  // is not represented in the normalized citations is deliberately inert.
  return rendered.replace(
    /(?:\[|\()?source:[A-Za-z0-9._:-]+(?:\]|\))?/g,
    "supporting source",
  );
}

export function citationPreview(citation: Citation) {
  const document = citation.document ?? citation.source;
  const base = document.replace(/\.(?:md|txt|html?|pdf|docx)$/i, "");
  const law = base.match(/^ley-(\d+)-de-(\d+)$/i);
  const titleLabel = citation.title.split(/\s+[—·]\s+/)[0] || document;
  const documentLabel = law
    ? `Ley ${law[1]} de ${law[2]}`
    : titleLabel.replace(/\.(?:md|txt|html?|pdf|docx)$/i, "");
  const article = citation.article
    ? `Artículo ${citation.article.replace(/^art[ií]culo\s+/i, "")}`
    : null;
  const lines =
    citation.startLine && citation.endLine
      ? `líneas ${citation.startLine}–${citation.endLine}`
      : null;
  const page = citation.pageNumber ? `página ${citation.pageNumber}` : null;
  const section = citation.sectionPath?.length
    ? citation.sectionPath.join(" › ")
    : null;
  return [documentLabel, article, page, section, lines]
    .filter(Boolean)
    .join(" · ");
}

function CitationLink({
  href,
  children,
  citations,
  onCitation,
  ...props
}: ComponentPropsWithoutRef<"a"> & {
  citations: Citation[];
  onCitation: (citationId: string, opener: HTMLElement) => void;
}) {
  const match = href?.match(/^#citation-(\d+)$/);
  const number = match ? Number(match[1]) : 0;
  const citation = citations[number - 1];
  if (!citation) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  const preview = citationPreview(citation);
  return (
    <span className="group/citation relative inline-flex">
      <button
        type="button"
        data-citation-id={citation.id}
        className="rounded px-1 font-semibold text-primary underline decoration-information-border underline-offset-2 hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`Open source ${number}: ${preview}`}
        aria-describedby={`citation-preview-${number}`}
        onClick={(event) => onCitation(citation.id, event.currentTarget)}
      >
        [{number}]
      </button>
      <span
        id={`citation-preview-${number}`}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-72 -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-xs font-normal text-white shadow-lg group-hover/citation:block group-focus-within/citation:block"
      >
        {preview}
      </span>
    </span>
  );
}

export function CitedAnswer({
  text,
  citations,
  onCitation,
}: {
  text: string;
  citations: Citation[];
  onCitation: (citationId: string, opener: HTMLElement) => void;
}) {
  const unique = uniqueCitations(citations);
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: (props) => (
          <CitationLink {...props} citations={unique} onCitation={onCitation} />
        ),
      }}
    >
      {citationMarkdown(text, unique)}
    </ReactMarkdown>
  );
}
