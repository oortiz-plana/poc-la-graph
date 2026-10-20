"use client";

import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
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

export function ObjectTabs({
  value,
  onChange,
  children,
}: {
  value: PlsqlTab;
  onChange: (tab: PlsqlTab) => void;
  children: ReactNode;
}) {
  const t = useTranslations("plsqlWorkspace.header");
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as PlsqlTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList
        aria-label={t("objectViews")}
        className="mt-3 h-auto max-w-full shrink-0 self-start overflow-x-auto overflow-y-hidden"
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
      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        {children}
      </div>
    </Tabs>
  );
}
