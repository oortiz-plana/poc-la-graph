"use client";

import type { ReactNode, RefObject } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlsqlObject } from "@/lib/contracts";
import { ObjectKindBadge } from "./plsql-atoms";

export const OBJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "dependencies", label: "Dependencies" },
  { value: "impact", label: "Impact" },
  { value: "paths", label: "Paths" },
  { value: "source", label: "Source" },
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
  const segments = object.qualifiedName.split(".");
  return (
    <header>
      <nav aria-label="Qualified name">
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
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as PlsqlTab)}>
      <TabsList
        aria-label="Object views"
        className="mt-3 h-auto max-w-full overflow-x-auto"
      >
        {OBJECT_TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="px-1.5 text-[13px] max-md:min-h-11 sm:px-3 sm:text-sm"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
