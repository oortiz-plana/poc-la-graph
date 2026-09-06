"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { PlsqlObject } from "@/lib/contracts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ObjectKindIcon } from "./plsql-atoms";
import { ObjectRow } from "./object-row";

export type PackageGroup = {
  key: string;
  name: string;
  packageRef?: PlsqlObject;
  members: PlsqlObject[];
};

/**
 * Collapsible parent row for one package, with its routines indented below.
 * The chevron toggles membership visibility only; selection is reported
 * through `onSelect` independently, so collapsing/expanding never disturbs
 * whichever object is currently selected.
 */
export function PackageNode({
  group,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  group: PackageGroup;
  selectedId?: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (object: PlsqlObject) => void;
}) {
  const isSelected = group.packageRef?.id === selectedId;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" && !expanded) {
      event.preventDefault();
      onToggle();
    } else if (event.key === "ArrowLeft" && expanded) {
      event.preventDefault();
      onToggle();
    }
  }

  return (
    <li>
      <div className="flex items-stretch gap-0.5" onKeyDown={handleKeyDown}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} package ${group.name}`}
          onClick={onToggle}
          className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronDown aria-hidden className="h-4 w-4" />
          ) : (
            <ChevronRight aria-hidden className="h-4 w-4" />
          )}
        </button>
        {group.packageRef ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(group.packageRef!)}
                className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm font-semibold ${
                  isSelected
                    ? "bg-selected text-primary"
                    : "text-foreground hover:bg-background focus-visible:bg-background"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                <ObjectKindIcon kind="Package" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{group.packageRef.qualifiedName}</TooltipContent>
          </Tooltip>
        ) : (
          <p
            title={group.name}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 py-1 text-sm font-semibold text-text-secondary"
          >
            <ObjectKindIcon kind="Package" className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
          </p>
        )}
      </div>
      {expanded && group.members.length > 0 && (
        <ul aria-label={`${group.name} members`} className="mt-0.5">
          {group.members.map((member) => (
            <ObjectRow
              key={member.id}
              object={member}
              selected={member.id === selectedId}
              onSelect={onSelect}
              indent
            />
          ))}
        </ul>
      )}
    </li>
  );
}
