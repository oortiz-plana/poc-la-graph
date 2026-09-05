"use client";

import { Copy, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getPlsqlFileSource,
  getPlsqlObjectSource,
  type PlsqlProblemCode,
} from "@/lib/api";
import type { PlsqlSourceContent } from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";

export type SourceRequest =
  | { kind: "object"; objectId: string }
  | { kind: "file"; fileId: string; startLine?: number; endLine?: number };

type SourceStatus = "loading" | "ready" | "error";

function useWideViewport() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1024px)");
    if (!media) {
      setWide(true);
      return;
    }
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

export function SourceViewer({
  request,
  onClose,
}: {
  request: SourceRequest;
  onClose: () => void;
}) {
  const wide = useWideViewport();
  const titleRef = useRef<HTMLHeadingElement>(null);
  if (wide) {
    return <SourcePanel request={request} onClose={onClose} />;
  }
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        aria-labelledby="plsql-source-sheet-title"
        onOpenAutoFocus={(event) => {
          // Radix would focus the Close button; land on the sheet heading so
          // screen readers hear where the source viewer opened.
          const title = document.getElementById("plsql-source-sheet-title");
          if (title) {
            event.preventDefault();
            title.focus();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle
            id="plsql-source-sheet-title"
            tabIndex={-1}
            ref={titleRef}
          >
            Source
          </SheetTitle>
          <SheetDescription>
            Read-only source text from the analyzed corpus.
          </SheetDescription>
        </SheetHeader>
        <SourceBody request={request} />
      </SheetContent>
    </Sheet>
  );
}

function SourcePanel({
  request,
  onClose,
}: {
  request: SourceRequest;
  onClose: () => void;
}) {
  const headingId = "plsql-source-heading";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The inline panel can open far below the clicked evidence link: move
    // focus to its heading so keyboard and screen-reader users follow the
    // newly opened content (mirrors the evidence drawer convention).
    headingRef.current?.focus();
  }, []);
  return (
    <section aria-labelledby={headingId} className="mt-10 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold"
        >
          Source
        </h2>
        <Button variant="outline" onClick={onClose}>
          Close source
        </Button>
      </div>
      <SourceBody request={request} />
    </section>
  );
}

export function SourceBody({ request }: { request: SourceRequest }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SourceStatus>("loading");
  const [content, setContent] = useState<PlsqlSourceContent>();
  const [copied, setCopied] = useState(false);
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorCode(undefined);
    const loader =
      request.kind === "object"
        ? getPlsqlObjectSource(request.objectId)
        : getPlsqlFileSource(request.fileId, {
            startLine: request.startLine,
            endLine: request.endLine,
          });
    loader
      .then((value) => {
        if (cancelled) return;
        if (!value) {
          setStatus("error");
          return;
        }
        setContent(value);
        setCopied(false);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorCode(problemCodeOf(error));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request, attempt]);

  const highlight = content?.highlight ?? null;
  useEffect(() => {
    if (!highlight) return;
    const element = document.getElementById(lineAnchor(highlight.startLine));
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center" });
    }
  }, [highlight]);

  if (status === "loading") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary"
      >
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        Loading source…
      </p>
    );
  }
  if (status === "error" || !content) {
    return (
      <AnalysisError
        code={errorCode}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const { file, lines } = content;
  const range =
    highlight && highlight.endLine !== highlight.startLine
      ? `${highlight.startLine}–${highlight.endLine}`
      : highlight
        ? String(highlight.startLine)
        : null;

  async function copyPath() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(file.path);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function focusLine(line: number) {
    const element = document.getElementById(lineAnchor(line));
    if (!element) return;
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center" });
    }
    element.focus({ preventScroll: true });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-words text-sm text-text-secondary">
          <span className="break-words">{file.path}</span>
          {range !== null && <span aria-hidden> · line {range}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {highlight && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => focusLine(highlight.startLine)}
            >
              Go to line {highlight.startLine}
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void copyPath()}
          >
            <Copy aria-hidden /> {copied ? "Copied" : "Copy path"}
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? "Source path copied to clipboard." : ""}
      </p>
      {lines.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          File is empty
        </p>
      ) : (
        <ol
          aria-label="File lines"
          className="mt-3 max-h-[70dvh] overflow-auto rounded-lg border bg-background font-mono text-xs leading-5"
        >
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const isStart =
              highlight !== null && lineNumber === highlight.startLine;
            const inRange =
              highlight !== null &&
              lineNumber >= highlight.startLine &&
              lineNumber <= highlight.endLine;
            return (
              <li
                key={lineNumber}
                id={lineAnchor(lineNumber)}
                tabIndex={isStart ? -1 : undefined}
                aria-current={isStart ? "location" : undefined}
                data-highlighted={inRange ? "true" : undefined}
                className={`flex scroll-m-20 items-stretch gap-0 ${
                  inRange ? "bg-selected" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="select-none border-r border-border px-3 py-0.5 text-right text-text-secondary"
                >
                  {lineNumber}
                </span>
                <span className="whitespace-pre px-3 py-0.5 text-foreground">
                  {line === "" ? "\u00a0" : line}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function lineAnchor(line: number) {
  return `plsql-source-line-${line}`;
}
