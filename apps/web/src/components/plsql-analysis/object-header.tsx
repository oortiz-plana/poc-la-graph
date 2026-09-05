"use client";

import { Braces, Network, Route } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
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
  onSelectTab,
  headingRef,
  actions,
}: {
  object: PlsqlObject;
  onSelectTab: (tab: PlsqlTab) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  actions?: ReactNode;
}) {
  const segments = object.qualifiedName.split(".");
  return (
    <header>
      <p aria-label="Qualified name" className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>/</span>}
            <span>{segment}</span>
          </span>
        ))}
      </p>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectTab("source")}
          >
            <Braces aria-hidden /> Open source
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectTab("impact")}
          >
            <Network aria-hidden /> Analyze impact
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectTab("paths")}
          >
            <Route aria-hidden /> Find path
          </Button>
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
      <TabsList aria-label="Object views" className="mt-3">
        {OBJECT_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
