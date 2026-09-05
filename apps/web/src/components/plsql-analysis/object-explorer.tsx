"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchPlsqlObjects, type PlsqlProblemCode } from "@/lib/api";
import type { PlsqlObject, PlsqlObjectKind } from "@/lib/contracts";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { ObjectKindBadge, ObjectKindIcon } from "./plsql-atoms";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 100;

const KIND_FILTERS: { label: string; kinds: PlsqlObjectKind[] | undefined }[] = [
  { label: "All", kinds: undefined },
  { label: "Packages", kinds: ["Package"] },
  { label: "Routines", kinds: ["Procedure", "Function"] },
  { label: "Tables", kinds: ["Table"] },
  { label: "Views", kinds: ["View"] },
];

const ROUTINE_KINDS = new Set<PlsqlObjectKind>(["Procedure", "Function"]);

type Group = { key: string; name: string; packageRef?: PlsqlObject; members: PlsqlObject[] };

function groupResults(objects: PlsqlObject[]): { groups: Group[]; ungrouped: PlsqlObject[] } {
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
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
      group = { key: packageName, name: packageName.split(".").at(-1) ?? packageName, members: [] };
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
  const [filter, setFilter] = useState(KIND_FILTERS[0]);
  const [status, setStatus] = useState<"idle" | "searching" | "ready" | "error">("idle");
  const [objects, setObjects] = useState<PlsqlObject[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [errorCode, setErrorCode] = useState<PlsqlProblemCode>();
  const [announcement, setAnnouncement] = useState("");
  const [attempt, setAttempt] = useState(0);
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

  const { groups, ungrouped } = groupResults(objects);
  const isEmpty = status === "ready" && groups.length === 0 && ungrouped.length === 0;

  return (
    <div className="flex flex-col p-3">
      <label className="block text-sm font-medium">
        <span className="sr-only">Search objects</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search packages, routines and tables..."
          className="mt-1 min-h-11 w-full rounded-md border bg-surface px-3 text-sm"
        />
      </label>
      <div role="group" aria-label="Object kind" className="mt-2 flex flex-wrap gap-1">
        {KIND_FILTERS.map((entry) => {
          const active = entry.label === filter.label;
          return (
            <button
              key={entry.label}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(entry)}
              className={`min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium ${
                active
                  ? "border-transparent bg-selected text-primary"
                  : "bg-surface text-text-secondary hover:bg-background"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {status === "searching" && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Searching…
        </p>
      )}
      {status === "error" && (
        <div className="mt-3">
          <AnalysisError code={errorCode} onRetry={() => setAttempt((current) => current + 1)} />
        </div>
      )}
      {truncated && status === "ready" && (
        <p className="mt-2 text-xs text-warning">Results truncated</p>
      )}
      {isEmpty && (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
          No objects match
        </p>
      )}
      {status === "ready" && (groups.length > 0 || ungrouped.length > 0) && (
        <ul aria-label="Object search results" className="mt-2 space-y-1">
          {groups.map((group) => (
            <li key={group.key}>
              {group.packageRef ? (
                <button
                  type="button"
                  aria-current={group.packageRef.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(group.packageRef!)}
                  className={`flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-semibold ${
                    group.packageRef.id === selectedId
                      ? "bg-selected text-primary"
                      : "text-text-secondary hover:bg-background"
                  }`}
                >
                  <ObjectKindIcon kind="Package" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <ObjectKindBadge kind="Package" />
                </button>
              ) : (
                <p className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-sm font-semibold text-text-secondary">
                  <ObjectKindIcon kind="Package" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <ObjectKindBadge kind="Package" />
                </p>
              )}
              {group.members.length > 0 && (
                <ul className="ml-3">
                  {group.members.map((member) => (
                    <ObjectRow key={member.id} object={member} selected={member.id === selectedId} onSelect={onSelect} />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {ungrouped.map((object) => (
            <ObjectRow key={object.id} object={object} selected={object.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function ObjectRow({
  object,
  selected,
  onSelect,
}: {
  object: PlsqlObject;
  selected: boolean;
  onSelect: (object: PlsqlObject) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(object)}
        className={`flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
          selected ? "bg-selected text-primary" : "hover:bg-background"
        }`}
      >
        <ObjectKindIcon kind={object.kind} className="h-4 w-4 shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate">{object.name}</span>
        {selected && <span aria-hidden>●</span>}
      </button>
    </li>
  );
}
