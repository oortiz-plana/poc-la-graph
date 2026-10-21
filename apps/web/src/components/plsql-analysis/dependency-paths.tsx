"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useState,
  type FormEvent,
  type ComponentProps,
} from "react";
import { Button } from "@/components/ui/button";
import { findPlsqlPaths } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlPath,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { AnalysisError } from "./analysis-error";
import {
  DependencyDetailTable,
  type DetailTableColumn,
} from "./dependency-detail-table";
import { DependencyPathTrail } from "./dependency-path-trail";
import { PlsqlObjectCombobox } from "./object-combobox";
import { useEvidenceLineLabel, useHopText } from "./plsql-atoms";
import { CopyValueButton } from "./copy-value-button";
import { InsightPanel } from "./insight-panel";
import { ListDetailSplit } from "./list-detail-split";
import { SourceBody } from "./source-viewer";
import { usePagedQuery } from "./use-paged-query";
import {
  ANALYSIS_PAGE_SIZE,
  AnalysisPageNavigator,
  AnalysisPaginationScope,
} from "./analysis-pagination";

type PathStatus = "idle" | "loading" | "ready" | "error";

/** One compact result row: a whole traced route between the chosen objects. */
type PathListRow = { id: string; path: PlsqlPath };

export function DependencyPathsSection(
  props: ComponentProps<typeof DependencyPathsContent>,
) {
  return (
    <AnalysisPaginationScope>
      <DependencyPathsContent {...props} />
    </AnalysisPaginationScope>
  );
}

function DependencyPathsContent({
  initialFrom,
  onInspectObject,
  onOpenEvidence,
  onInspectPath,
  onInspectEdge,
}: {
  initialFrom?: PlsqlObject;
  /** Route nodes are inspected in place; clicking one must never navigate
   * away or reset the traced route (see the shared onInspectEdge below). */
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectPath?: (path: PlsqlPath) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const t = useTranslations("plsqlImpact.paths");
  const hopText = useHopText();
  const [from, setFrom] = useState<PlsqlObject>();
  const [to, setTo] = useState<PlsqlObject>();
  const [submitted, setSubmitted] = useState<{
    fromId: string;
    toId: string;
    request: number;
  }>();
  const [selectedId, setSelectedId] = useState<string>();
  const headingId = "plsql-dependency-paths-heading";

  const [page, setPage] = useState(0);
  const pathsPage = usePagedQuery({
    listKey: submitted
      ? `paths|${submitted.fromId}|${submitted.toId}|${submitted.request}`
      : null,
    page,
    fetchPage: (requestedPage) =>
      findPlsqlPaths(submitted?.fromId ?? "", submitted?.toId ?? "", {
        limit: ANALYSIS_PAGE_SIZE,
        offset: requestedPage * ANALYSIS_PAGE_SIZE,
      }),
  });
  const result = pathsPage.data;
  const status: PathStatus = !submitted
    ? "idle"
    : result
      ? "ready"
      : pathsPage.failed
        ? "error"
        : "loading";

  useEffect(() => {
    setFrom(initialFrom);
    setSubmitted(undefined);
    setSelectedId(undefined);
    setPage(0);
  }, [initialFrom]);

  const canTrace = Boolean(from && to && from.id !== to.id);

  function tracePaths(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!from || !to || from.id === to.id) return;
    setSubmitted((current) => ({
      fromId: from.id,
      toId: to.id,
      request: (current?.request ?? 0) + 1,
    }));
    setSelectedId(undefined);
    setPage(0);
  }

  function changePage(next: number) {
    setPage(next);
    setSelectedId(undefined);
  }

  function selectPath(path: PlsqlPath) {
    onInspectPath?.(path);
    setSelectedId((current) => (current === path.id ? undefined : path.id));
  }

  const rows: PathListRow[] = (result?.items ?? []).map((path) => ({
    id: path.id,
    path,
  }));
  const columns: DetailTableColumn<PathListRow>[] = [
    {
      header: t("columnRoute"),
      cell: (row) => (
        <span
          title={row.path.nodes.map((node) => node.qualifiedName).join(" → ")}
          className="break-words font-medium"
        >
          {row.path.nodes.map((node) => node.name).join(" → ")}
        </span>
      ),
    },
    {
      header: t("columnHops"),
      align: "right",
      cell: (row) => hopText(row.path.hopCount),
    },
  ];
  const selected = result?.items.find((path) => path.id === selectedId);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        {t("heading")}
      </h2>
      <form onSubmit={tracePaths} className="mt-3 max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <PlsqlObjectCombobox
            id="plsql-path-from"
            label={t("fromObject")}
            selected={from}
            onSelect={setFrom}
          />
          <PlsqlObjectCombobox
            id="plsql-path-to"
            label={t("toObject")}
            selected={to}
            onSelect={setTo}
          />
        </div>
        <Button type="submit" disabled={!canTrace} className="mt-3">
          {t("findPaths")}
        </Button>
        {!canTrace && (
          <p className="mt-2 text-xs text-text-secondary">{t("chooseTwo")}</p>
        )}
      </form>

      {status === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError code={pathsPage.errorCode} onRetry={pathsPage.retry} />
        </div>
      )}
      {status === "ready" && result && (
        <div className="mt-3">
          <ListDetailSplit
            list={
              <>
                <DependencyDetailTable
                  ariaLabel={t("tableLabel")}
                  columns={columns}
                  rows={rows}
                  getRowId={(row) => row.id}
                  selectedId={selectedId}
                  onSelectRow={(row) => selectPath(row.path)}
                  emptyMessage={t("empty")}
                />
                {result.count > 0 && (
                  <AnalysisPageNavigator
                    page={page}
                    pageSize={ANALYSIS_PAGE_SIZE}
                    total={result.count}
                    loading={pathsPage.refreshing}
                    error={pathsPage.failed}
                    onPageChange={changePage}
                    onRetry={pathsPage.retry}
                  />
                )}
              </>
            }
            detail={
              selected && (
                <SelectedPath
                  key={selected.id}
                  path={selected}
                  onClose={() => setSelectedId(undefined)}
                  onInspectObject={onInspectObject}
                  onOpenEvidence={onOpenEvidence}
                  onInspectEdge={onInspectEdge}
                />
              )
            }
          />
        </div>
      )}
    </section>
  );
}

function SelectedPath({
  path,
  onClose,
  onInspectObject,
  onOpenEvidence,
  onInspectEdge,
}: {
  path: PlsqlPath;
  onClose: () => void;
  onInspectObject: (reference: PlsqlObjectReference) => void;
  onOpenEvidence: (evidence: PlsqlSourceCoordinate | null) => void;
  onInspectEdge?: (edge: PlsqlDependency) => void;
}) {
  const t = useTranslations("plsqlImpact.paths");
  const evidenceLineLabel = useEvidenceLineLabel();
  const hopText = useHopText();
  const destination = path.nodes[path.nodes.length - 1];
  const finalEdge = path.relationships[path.relationships.length - 1];
  // Which hop's evidence the "Source evidence" pane shows: the final hop by
  // default, or whichever hop's evidence link in the trail was clicked. A
  // hop link only ever selects it in place here; it never jumps to the
  // Source tab (that's "Open full source" below, an explicit escalation).
  const [selectedEvidence, setSelectedEvidence] = useState(finalEdge?.evidence);
  const lineLabel = evidenceLineLabel(selectedEvidence);

  return (
    <InsightPanel
      ariaLabel={t("selectedPath")}
      title={t("selectedPath")}
      closeLabel={t("closeSelectedPath")}
      onClose={onClose}
      actions={<CopyValueButton value={destination.qualifiedName} />}
      trail={
        <>
          <DependencyPathTrail
            path={path}
            onOpenObject={onInspectObject}
            onOpenEvidence={setSelectedEvidence}
            onInspectEdge={onInspectEdge}
          />
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">
              {hopText(path.hopCount)}
            </span>
            {lineLabel !== undefined && <span>{lineLabel}</span>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2"></div>
        </>
      }
      evidence={
        <>
          {selectedEvidence?.sourceFileId ? (
            <SourceBody
              heading={t("sourceEvidence")}
              compact
              onOpenFullSource={() => onOpenEvidence(selectedEvidence)}
              request={{
                kind: "file",
                fileId: selectedEvidence.sourceFileId,
                startLine: selectedEvidence.startLine ?? undefined,
                endLine: selectedEvidence.startLine ?? undefined,
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
              {t("noEvidence")}
            </p>
          )}
        </>
      }
    />
  );
}
