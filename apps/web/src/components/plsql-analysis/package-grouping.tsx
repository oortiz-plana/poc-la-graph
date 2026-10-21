"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import type { PlsqlObjectReference } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { displayPackageOf } from "./plsql-atoms";

type PackageGroup<T> = {
  /** Package name, or `undefined` for objects that live outside any package. */
  packageName: string | undefined;
  items: T[];
};

/** The package an object is filed under: a routine under its package, a package under itself. */
export function packageKeyOf(
  reference: PlsqlObjectReference,
): string | undefined {
  return reference.kind === "Package"
    ? reference.name
    : displayPackageOf(reference);
}

/**
 * Groups items by package. Packages are alphabetical and items without one
 * come last; each group keeps the incoming item order.
 */
export function groupByPackage<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
): PackageGroup<T>[] {
  const groups = new Map<string | undefined, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === undefined || b === undefined) {
        return a === b ? 0 : a === undefined ? 1 : -1;
      }
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .map(([packageName, groupItems]) => ({ packageName, items: groupItems }));
}

/** Stable React key for a group (the no-package group has no name). */
export function groupDomKey(packageName: string | undefined): string {
  return packageName ?? "\u0000no-package";
}

/**
 * The workspace's "Expand all / Collapse all" command. `mode` is the state
 * every group starts in; a new `epoch` makes every table reset to it, which
 * discards the groups the user had toggled by hand.
 */
export type GroupExpansion = { mode: "expanded" | "collapsed"; epoch: number };

const GroupExpansionContext = createContext<GroupExpansion>({
  mode: "expanded",
  epoch: 0,
});

export const GroupExpansionProvider = GroupExpansionContext.Provider;

/**
 * Which package groups are collapsed. A group follows the workspace-wide
 * mode unless the user toggled it individually since the last command, so no
 * table needs to know its group names for "collapse all" to work.
 */
export function useCollapsedGroups() {
  const command = useContext(GroupExpansionContext);
  const [state, setState] = useState({
    epoch: command.epoch,
    mode: command.mode,
    toggled: new Set<string | undefined>(),
  });
  let current = state;
  if (command.epoch !== state.epoch) {
    current = { epoch: command.epoch, mode: command.mode, toggled: new Set() };
    setState(current);
  }
  const isCollapsed = (packageName: string | undefined) =>
    (current.mode === "collapsed") !== current.toggled.has(packageName);
  return {
    isCollapsed,
    toggle: (packageName: string | undefined) =>
      setState((previous) => {
        const toggled = new Set(previous.toggled);
        if (toggled.has(packageName)) toggled.delete(packageName);
        else toggled.add(packageName);
        return { ...previous, toggled };
      }),
  };
}

/** Header row of one package group: a disclosure button spanning the table. */
export function PackageGroupHeader({
  packageName,
  count,
  collapsed,
  colSpan,
  onToggle,
}: {
  packageName: string | undefined;
  count: number;
  collapsed: boolean;
  colSpan: number;
  onToggle: () => void;
}) {
  const t = useTranslations("plsqlWorkspace.grouping");
  const name = packageName ?? t("noPackage");
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <tr className="bg-background">
      <th
        scope="colgroup"
        colSpan={colSpan}
        className="p-0 text-left font-normal"
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={t("groupToggle", { name, count })}
          onClick={onToggle}
          className="flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <Chevron aria-hidden className="h-4 w-4 shrink-0" />
          <span
            className={cn(
              "font-semibold",
              packageName === undefined && "text-text-secondary",
            )}
          >
            {name}
          </span>
          <span className="text-xs text-text-secondary">
            {t("count", { count })}
          </span>
        </button>
      </th>
    </tr>
  );
}
