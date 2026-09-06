"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlsqlObjectKind } from "@/lib/contracts";

export type ObjectFilterKey =
  "all" | "packages" | "routines" | "tables" | "views" | PlsqlObjectKind;

export type ObjectFilter = {
  key: ObjectFilterKey;
  label: string;
  kinds: PlsqlObjectKind[] | undefined;
};

export const PRIMARY_FILTERS: ObjectFilter[] = [
  { key: "all", label: "All", kinds: undefined },
  { key: "packages", label: "Packages", kinds: ["Package"] },
  { key: "routines", label: "Routines", kinds: ["Procedure", "Function"] },
  { key: "tables", label: "Tables", kinds: ["Table"] },
  { key: "views", label: "Views", kinds: ["View"] },
];

/** Less common kinds, tucked behind the "More" menu to keep the primary row compact. */
export const MORE_FILTERS: ObjectFilter[] = [
  { key: "Trigger", label: "Triggers", kinds: ["Trigger"] },
  { key: "Sequence", label: "Sequences", kinds: ["Sequence"] },
  { key: "Index", label: "Indexes", kinds: ["Index"] },
  { key: "Synonym", label: "Synonyms", kinds: ["Synonym"] },
  { key: "Type", label: "Types", kinds: ["Type"] },
  {
    key: "AnonymousBlock",
    label: "Anonymous blocks",
    kinds: ["AnonymousBlock"],
  },
];

export const DEFAULT_FILTER = PRIMARY_FILTERS[0];

function isMoreFilter(filter: ObjectFilter): boolean {
  return MORE_FILTERS.some((entry) => entry.key === filter.key);
}

export function ObjectFilters({
  active,
  onChange,
}: {
  active: ObjectFilter;
  onChange: (filter: ObjectFilter) => void;
}) {
  const moreActive = isMoreFilter(active);
  return (
    <div role="group" aria-label="Object kind" className="flex flex-wrap gap-1">
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
            {entry.label}
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
            {moreActive ? active.label : "More"}
            <ChevronDown aria-hidden className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MORE_FILTERS.map((entry) => (
            <DropdownMenuItem
              key={entry.key}
              onSelect={() => onChange(entry)}
              className={
                entry.key === active.key
                  ? "bg-selected text-primary"
                  : undefined
              }
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
