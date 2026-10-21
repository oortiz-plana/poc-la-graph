"use client";

import { ChevronsDownUp, ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { searchPlsqlObjects, type PlsqlProblemCode } from "@/lib/api";
import type { PlsqlObject, PlsqlObjectKind } from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { CompactPageNavigator } from "./analysis-pagination";
import {
  DEFAULT_FILTER,
  ObjectFilters,
  type ObjectFilter,
} from "./object-filters";
import { PackageNode, type PackageGroup } from "./package-node";
import { ObjectRow } from "./object-row";
import { useRovingFocus } from "./use-roving-focus";

const SEARCH_DEBOUNCE_MS = 300;
/** Matches are read one page at a time: a project holds tens of thousands of objects. */
const SEARCH_LIMIT = 100;

const ROUTINE_KINDS = new Set<PlsqlObjectKind>(["Procedure", "Function"]);

/**
 * One Explorer row in display order: a package with its members, or an object
 * that lives outside any package. The server lists results alphabetically by
 * top-level name, so keeping first-seen order interleaves both kinds.
 */
type ExplorerEntry =
  | { kind: "group"; group: PackageGroup }
  | { kind: "object"; object: PlsqlObject };

function groupResults(objects: PlsqlObject[]): {
  groups: PackageGroup[];
  entries: ExplorerEntry[];
} {
  const groups: PackageGroup[] = [];
  const entries: ExplorerEntry[] = [];
  const byKey = new Map<string, PackageGroup>();
  for (const object of objects) {
    const packageName =
      object.kind === "Package"
        ? `${object.schema}.${object.name}`
        : object.owner && ROUTINE_KINDS.has(object.kind)
          ? `${object.schema}.${object.owner}`
          : undefined;
    if (!packageName) {
      entries.push({ kind: "object", object });
      continue;
    }
    let group = byKey.get(packageName);
    if (!group) {
      group = {
        key: packageName,
        name: packageName.split(".").at(-1) ?? packageName,
        members: [],
      };
      byKey.set(packageName, group);
      groups.push(group);
      entries.push({ kind: "group", group });
    }
    if (object.kind === "Package") group.packageRef = object;
    else group.members.push(object);
  }
  return { groups, entries };
}

export function ObjectExplorer({
  selectedId,
  onSelect,
  resetSignal = 0,
  filterRequest,
}: {
  selectedId?: string;
  onSelect: (object: PlsqlObject) => void;
  /** Changing this value clears the search, the kind filter and the collapsed packages. */
  resetSignal?: number;
  /** A new `id` applies `filter` (and clears the search), e.g. from a landing shortcut. */
  filterRequest?: { id: number; filter: ObjectFilter };
}) {
  const t = useTranslations("plsqlWorkspace.explorer");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ObjectFilter>(DEFAULT_FILTER);
  const [status, setStatus] = useState<
    "idle" | "searching" | "ready" | "error"
  >("idle");
  const [objects, setObjects] = useState<PlsqlObject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [announcement, setAnnouncement] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestSeq = useRef(0);
  const lastResetSignal = useRef(resetSignal);
  // Starts empty so a request made before this Explorer mounted (a drawer
  // that opens for the first time) is still applied.
  const lastFilterRequest = useRef<number>(undefined);
  const { containerRef: listRef, containerProps: listProps } =
    useRovingFocus<HTMLUListElement>();

  useEffect(() => {
    const seq = ++requestSeq.current;
    setStatus("searching");
    setErrorCode(undefined);
    const timer = window.setTimeout(() => {
      searchPlsqlObjects(query, {
        kinds: filter.kinds,
        limit: SEARCH_LIMIT,
        offset: page * SEARCH_LIMIT,
      })
        .then((result) => {
          if (requestSeq.current !== seq) return;
          setObjects(result.items);
          setTotal(result.count);
          setStatus("ready");
          setAnnouncement(
            result.items.length === 0
              ? t("noMatchingAnnouncement")
              : t("matchingAnnouncement", { count: result.count }),
          );
        })
        .catch((error: unknown) => {
          if (requestSeq.current !== seq) return;
          setErrorCode(problemCodeOf(error));
          setStatus("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      requestSeq.current += 1;
    };
  }, [query, filter, page, attempt, t]);

  useEffect(() => {
    if (resetSignal === lastResetSignal.current) return;
    lastResetSignal.current = resetSignal;
    setQuery("");
    setFilter(DEFAULT_FILTER);
    setPage(0);
    setCollapsed(new Set());
  }, [resetSignal]);

  useEffect(() => {
    if (!filterRequest || filterRequest.id === lastFilterRequest.current)
      return;
    lastFilterRequest.current = filterRequest.id;
    setQuery("");
    setFilter(filterRequest.filter);
    setPage(0);
  }, [filterRequest]);

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseAll(keys: string[]) {
    setCollapsed(new Set(keys));
  }

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { groups, entries } = groupResults(objects);
  const isEmpty = status === "ready" && entries.length === 0;
  const groupKeys = groups.map((group) => group.key);
  const anyCollapsed = groupKeys.some((key) => collapsed.has(key));
  const allCollapsed =
    groupKeys.length > 0 && groupKeys.every((key) => collapsed.has(key));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 space-y-2 border-b bg-surface p-3">
        <label className="block text-sm font-medium">
          <span className="sr-only">{t("searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t("searchPlaceholder")}
            className="min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
          />
        </label>
        <ObjectFilters
          active={filter}
          onChange={(next) => {
            setFilter(next);
            setPage(0);
          }}
        >
          {status === "ready" && groups.length > 0 && (
            <div
              role="group"
              aria-label={t("packageGroups")}
              className="inline-flex shrink-0 divide-x overflow-hidden rounded-md border bg-surface"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none"
                aria-label={t("expandAll")}
                title={t("expandAll")}
                disabled={!anyCollapsed}
                onClick={expandAll}
              >
                <ChevronsUpDown aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none"
                aria-label={t("collapseAll")}
                title={t("collapseAll")}
                disabled={allCollapsed}
                onClick={() => collapseAll(groupKeys)}
              >
                <ChevronsDownUp aria-hidden />
              </Button>
            </div>
          )}
        </ObjectFilters>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-2">
        {status === "searching" && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            {t("searching")}
          </p>
        )}
        {status === "error" && (
          <AnalysisError
            code={errorCode}
            onRetry={() => setAttempt((current) => current + 1)}
          />
        )}
        {isEmpty && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-text-secondary">
            {t("noMatch")}
          </p>
        )}
        {status === "ready" && entries.length > 0 && (
          <ul
            ref={listRef}
            aria-label={t("results")}
            className="space-y-0.5"
            {...listProps}
          >
            {entries.map((entry) =>
              entry.kind === "group" ? (
                <PackageNode
                  key={entry.group.key}
                  group={entry.group}
                  selectedId={selectedId}
                  expanded={!collapsed.has(entry.group.key)}
                  onToggle={() => toggleGroup(entry.group.key)}
                  onSelect={onSelect}
                />
              ) : (
                <ObjectRow
                  key={entry.object.id}
                  object={entry.object}
                  selected={entry.object.id === selectedId}
                  onSelect={onSelect}
                />
              ),
            )}
          </ul>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      {total > SEARCH_LIMIT && (
        <div className="shrink-0 border-t bg-surface p-2">
          <CompactPageNavigator
            page={page}
            pageSize={SEARCH_LIMIT}
            total={total}
            loading={status === "searching"}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
