"use client";

import type { PlsqlObject } from "@/lib/contracts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ObjectKindIcon } from "./plsql-atoms";

/**
 * One selectable object row. Indented for package members; the accessible
 * name is the object's own name (kind is already conveyed by the icon and,
 * for members, by nesting under the package), while the tooltip surfaces the
 * full qualified name for names truncated by the fixed-width row.
 */
export function ObjectRow({
  object,
  selected,
  onSelect,
  indent = false,
}: {
  object: PlsqlObject;
  selected: boolean;
  onSelect: (object: PlsqlObject) => void;
  indent?: boolean;
}) {
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(object)}
            className={`flex min-h-8 items-center gap-2 rounded px-2 py-1 text-left text-sm ${
              indent ? "ml-6 w-[calc(100%-1.5rem)]" : "w-full"
            } ${
              selected
                ? "bg-selected font-medium text-primary"
                : "text-foreground hover:bg-background focus-visible:bg-background"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            <ObjectKindIcon
              kind={object.kind}
              className={`h-4 w-4 shrink-0 ${selected ? "" : "text-text-secondary"}`}
            />
            <span className="min-w-0 flex-1 truncate">{object.name}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{object.qualifiedName}</TooltipContent>
      </Tooltip>
    </li>
  );
}
