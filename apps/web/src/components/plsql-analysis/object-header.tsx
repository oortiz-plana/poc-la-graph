"use client";

import { useTranslations } from "next-intl";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlsqlObject } from "@/lib/contracts";
import { ObjectKindBadge } from "./plsql-atoms";

export const OBJECT_TABS = [
  { value: "overview" },
  { value: "dependencies" },
  { value: "impact" },
  { value: "paths" },
  { value: "source" },
] as const;

export type PlsqlTab = (typeof OBJECT_TABS)[number]["value"];

export function ObjectHeader({
  object,
  headingRef,
  actions,
}: {
  object: PlsqlObject;
  headingRef: RefObject<HTMLHeadingElement | null>;
  actions?: ReactNode;
}) {
  const t = useTranslations("plsqlWorkspace.header");
  const segments = object.qualifiedName.split(".");
  return (
    <header className="shrink-0">
      <nav aria-label={t("qualifiedName")}>
        <ol className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          {segments.map((segment, index) => (
            <li
              key={`${segment}-${index}`}
              aria-current={
                index === segments.length - 1 ? "location" : undefined
              }
              className="flex items-center gap-1"
            >
              {index > 0 && <span aria-hidden>/</span>}
              <span>{segment}</span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="break-words text-xl font-semibold focus:outline-none"
        >
          {object.name}
        </h1>
        <ObjectKindBadge kind={object.kind} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
        </div>
      </div>
    </header>
  );
}

/** Tabs whose rows can be filed under package headers. */
const GROUPABLE_TABS: ReadonlySet<PlsqlTab> = new Set([
  "overview",
  "dependencies",
  "impact",
]);

export function ObjectTabs({
  value,
  onChange,
  groupByPackage,
  onGroupByPackageChange,
  onExpandAllGroups,
  onCollapseAllGroups,
  children,
}: {
  value: PlsqlTab;
  onChange: (tab: PlsqlTab) => void;
  /** The workspace-wide "group by package" indicator; omit to hide it. */
  groupByPackage?: boolean;
  onGroupByPackageChange?: (groupByPackage: boolean) => void;
  /** Expand / collapse every package group; offered while grouping is on. */
  onExpandAllGroups?: () => void;
  onCollapseAllGroups?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("plsqlWorkspace.header");
  const tGrouping = useTranslations("plsqlWorkspace.grouping");
  const showGrouping =
    onGroupByPackageChange !== undefined && GROUPABLE_TABS.has(value);
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as PlsqlTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <TabsList
          aria-label={t("objectViews")}
          className="h-auto max-w-full self-start overflow-x-auto overflow-y-hidden"
        >
          {OBJECT_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="px-1.5 text-[13px] max-md:min-h-11 sm:px-3 sm:text-sm"
            >
              {t(`tabs.${tab.value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {showGrouping && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {groupByPackage && onExpandAllGroups && onCollapseAllGroups && (
              <div
                role="group"
                aria-label={tGrouping("groups")}
                className="flex items-center gap-1"
              >
                <Button variant="ghost" size="sm" onClick={onExpandAllGroups}>
                  <ChevronsUpDown aria-hidden /> {tGrouping("expandAll")}
                </Button>
                <Button variant="ghost" size="sm" onClick={onCollapseAllGroups}>
                  <ChevronsDownUp aria-hidden /> {tGrouping("collapseAll")}
                </Button>
              </div>
            )}
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groupByPackage ?? false}
                onChange={(event) =>
                  onGroupByPackageChange(event.target.checked)
                }
              />
              {tGrouping("toggle")}
            </label>
          </div>
        )}
      </div>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        {children}
      </div>
    </Tabs>
  );
}
