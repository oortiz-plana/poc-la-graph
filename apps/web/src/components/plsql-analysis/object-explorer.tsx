"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchPlsqlObjects, type PlsqlProblemCode } from "@/lib/api";
import type { PlsqlObject, PlsqlObjectKind } from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import {
  DEFAULT_FILTER,
  ObjectFilters,
  type ObjectFilter,
} from "./object-filters";
import { PackageNode, type PackageGroup } from "./package-node";
import { ObjectRow } from "./object-row";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 100;

const ROUTINE_KINDS = new Set<PlsqlObjectKind>(["Procedure", "Function"]);

function groupResults(objects: PlsqlObject[]): {
  groups: PackageGroup[];
  ungrouped: PlsqlObject[];
} {
  const groups: PackageGroup[] = [];
  const byKey = new Map<string, PackageGroup>();
  const ungrouped: PlsqlObject[] = [];
  for (const object of objects) {
    const packageName =
      object.kind === "Package"
        ? `${object.schema}.${object.name}`
        : object.owner && ROUTINE_KINDS.has(object.kind)
          ? `${object.schema}.${object.owner}`
          : undefined;
    if (!packageName) {
      ungrouped.push(object);
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
    }
    if (object.kind === "Package") group.packageRef = object;
    else group.members.push(object);
  }
  return { groups, ungrouped };
}

export function ObjectExplorer({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (object: PlsqlObject) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ObjectFilter>(DEFAULT_FILTER);
  const [status, setStatus] = useState<
    "idle" | "searching" | "ready" | "error"
  >("idle");
  const [objects, setObjects] = useState<PlsqlObject[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [announcement, setAnnouncement] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setStatus("searching");
    setErrorCode(undefined);
    const timer = window.setTimeout(() => {
      searchPlsqlObjects(query, { kinds: filter.kinds, limit: SEARCH_LIMIT })
        .then((page) => {
          if (requestSeq.current !== seq) return;
          setObjects(page.items);
          setTruncated(page.truncated);
          setStatus("ready");
          setAnnouncement(
            page.items.length === 0
              ? "No matching objects."
              : `${page.items.length} matching object${page.items.length === 1 ? "" : "s"}.`,
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
  }, [query, filter, attempt]);

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { groups, ungrouped } = groupResults(objects);
  const isEmpty =
    status === "ready" && groups.length === 0 && ungrouped.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 space-y-2 border-b bg-surface p-3">
        <label className="block text-sm font-medium">
          <span className="sr-only">Search objects</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search packages, routines and tables..."
            className="min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
          />
        </label>
        <ObjectFilters active={filter} onChange={setFilter} />
        {truncated && status === "ready" && (
          <p className="text-xs text-text-secondary">
            Showing first {SEARCH_LIMIT} results
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-2">
        {status === "searching" && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            Searching…
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
            No objects match
          </p>
        )}
        {status === "ready" && (groups.length > 0 || ungrouped.length > 0) && (
          <ul aria-label="Object search results" className="space-y-0.5">
            {groups.map((group) => (
              <PackageNode
                key={group.key}
                group={group}
                selectedId={selectedId}
                expanded={!collapsed.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
                onSelect={onSelect}
              />
            ))}
            {ungrouped.map((object) => (
              <ObjectRow
                key={object.id}
                object={object}
                selected={object.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  );
}
