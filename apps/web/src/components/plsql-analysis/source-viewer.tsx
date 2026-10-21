"use client";

import { Copy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import type { MonacoSourceEditorHandle } from "./monaco-source-editor";

// The Monaco editor is heavy and touches browser-only globals, so it is
// loaded lazily and rendered only after a client-side mount.
const MonacoSourceEditor = lazy(() => import("./monaco-source-editor"));

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
  const t = useTranslations("plsqlDependencies");
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
            {t("source.title")}
          </SheetTitle>
          <SheetDescription>{t("source.description")}</SheetDescription>
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
  const t = useTranslations("plsqlDependencies");
  const headingId = "plsql-source-heading";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The inline panel can open far below the clicked evidence link: move
    // focus to its heading so keyboard and screen-reader users follow the
    // newly opened content (mirrors the evidence drawer convention).
    headingRef.current?.focus();
  }, []);
  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold"
        >
          {t("source.title")}
        </h2>
        <Button variant="outline" onClick={onClose}>
          {t("source.close")}
        </Button>
      </div>
      <SourceBody request={request} fill />
    </section>
  );
}

export function SourceBody({
  request,
  heading,
  onOpenFullSource,
  fill = false,
  compact = false,
}: {
  request: SourceRequest;
  /** Visible title shown above the location line, e.g. "Source evidence" for
   * an inline inspector; omitted where the surrounding view already has its
   * own "Source" heading (the dedicated Source tab). */
  heading?: string;
  /** Escalates from an inline evidence preview to the full Source tab. */
  onOpenFullSource?: () => void;
  /** Stretch the editor to the remaining height of the parent flex column. */
  fill?: boolean;
  /** Use a shorter editor, for evidence shown beside a results list. */
  compact?: boolean;
}) {
  const t = useTranslations("plsqlDependencies");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SourceStatus>("loading");
  const [content, setContent] = useState<PlsqlSourceContent>();
  const [copied, setCopied] = useState(false);
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [mounted, setMounted] = useState(false);
  const editorRef = useRef<MonacoSourceEditorHandle>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          setErrorCode("analysis_not_found");
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

  if (status === "loading") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary"
      >
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        {t("source.loading")}
      </p>
    );
  }
  if (status === "error" || !content) {
    return (
      <AnalysisError
        code={errorCode}
        context="source"
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

  async function copyLocation() {
    const location = range !== null ? `${file.path}:${range}` : file.path;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(location);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function focusLine(line: number) {
    editorRef.current?.revealLine(line);
  }

  return (
    <div
      className={cn(!heading && "mt-4", fill && "flex min-h-0 flex-1 flex-col")}
    >
      {heading && (
        <h3 className="text-sm font-semibold text-text-secondary">{heading}</h3>
      )}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          heading && "mt-2",
        )}
      >
        <p className="min-w-0 break-words text-sm text-text-secondary">
          <span className="break-words">{file.path}</span>
          {range !== null && (
            <span aria-hidden> · {t("source.line", { range })}</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {highlight && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => focusLine(highlight.startLine)}
            >
              {t("source.goToEvidence")}
            </Button>
          )}
          {onOpenFullSource && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={onOpenFullSource}
            >
              {t("source.openFull")}
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void copyLocation()}
          >
            <Copy aria-hidden />{" "}
            {copied ? t("source.copied") : t("source.copyLocation")}
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? t("source.copiedAnnouncement") : ""}
      </p>
      {lines.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          {t("source.empty")}
        </p>
      ) : (
        <div className={cn("mt-3", fill && "flex min-h-0 flex-1 flex-col")}>
          {mounted && (
            <Suspense
              fallback={
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-text-secondary"
                >
                  <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                  {t("source.loadingEditor")}
                </p>
              }
            >
              <MonacoSourceEditor
                ref={editorRef}
                value={lines.join("\n")}
                language="sql"
                path={file.path}
                highlight={highlight}
                fill={fill}
                compact={compact}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
