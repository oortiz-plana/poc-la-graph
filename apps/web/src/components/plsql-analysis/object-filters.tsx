"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlsqlObjectKind } from "@/lib/contracts";

export type ObjectFilterKey =
  | "all"
  | "packages"
  | "routines"
  | "tables"
  | "views"
  | "Trigger"
  | "Sequence"
  | "Index"
  | "Synonym"
  | "Type"
  | "AnonymousBlock";

export type ObjectFilter = {
  key: ObjectFilterKey;
  kinds: PlsqlObjectKind[] | undefined;
  /** Set when the backend never returns this kind, so the filter stays disabled. */
  unavailable?: boolean;
};

const PRIMARY_FILTERS: ObjectFilter[] = [
  { key: "all", kinds: undefined },
  { key: "packages", kinds: ["Package"] },
  { key: "routines", kinds: ["Procedure", "Function"] },
  { key: "tables", kinds: ["Table"] },
  { key: "views", kinds: ["View"] },
];

/** Less common kinds, tucked behind the "More" menu to keep the primary row compact. */
const MORE_FILTERS: ObjectFilter[] = [
  { key: "Trigger", kinds: ["Trigger"] },
  { key: "Sequence", kinds: ["Sequence"] },
  { key: "Index", kinds: ["Index"] },
  { key: "Synonym", kinds: ["Synonym"], unavailable: true },
  { key: "Type", kinds: ["Type"] },
  { key: "AnonymousBlock", kinds: ["AnonymousBlock"] },
];

export const DEFAULT_FILTER = PRIMARY_FILTERS[0];

/** The primary filter behind a key, e.g. for a shortcut that opens the Explorer on tables only. */
export function primaryFilter(key: ObjectFilterKey): ObjectFilter {
  return PRIMARY_FILTERS.find((entry) => entry.key === key) ?? DEFAULT_FILTER;
}

function isMoreFilter(filter: ObjectFilter): boolean {
  return MORE_FILTERS.some((entry) => entry.key === filter.key);
}

export function ObjectFilters({
  active,
  onChange,
  children,
}: {
  active: ObjectFilter;
  onChange: (filter: ObjectFilter) => void;
  /** Extra controls that share the chips' row, pushed to its trailing edge. */
  children?: ReactNode;
}) {
  const t = useTranslations("plsqlWorkspace.filters");
  const moreActive = isMoreFilter(active);
  return (
    <div role="group" aria-label={t("group")} className="flex flex-wrap gap-1">
      {PRIMARY_FILTERS.map((entry) => {
        const pressed = entry.key === active.key;
        return (
          <button
            key={entry.key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(entry)}
            className={`min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium ${
              pressed
                ? "border-transparent bg-selected text-primary"
                : "bg-surface text-text-secondary hover:bg-background"
            }`}
          >
            {t(entry.key)}
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-pressed={moreActive}
            className={`flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
              moreActive
                ? "border-transparent bg-selected text-primary"
                : "bg-surface text-text-secondary hover:bg-background"
            }`}
          >
            {moreActive ? t(active.key) : t("more")}
            <ChevronDown aria-hidden className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MORE_FILTERS.map((entry) => (
            <DropdownMenuItem
              key={entry.key}
              disabled={entry.unavailable === true}
              onSelect={() => onChange(entry)}
              className={
                entry.key === active.key
                  ? "bg-selected text-primary"
                  : undefined
              }
            >
              {t(entry.key)}
              {entry.unavailable && (
                <span className="text-xs text-text-muted">
                  ({t("notSearchable")})
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {children && <div className="ml-auto">{children}</div>}
    </div>
  );
}
