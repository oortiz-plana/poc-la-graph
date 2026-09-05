"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Three-pane PL/SQL workspace: Object Explorer (contextual code navigation),
 * main analysis area, and Inspector (secondary details). The application
 * sidebar stays outside this component. Panes scroll independently; on
 * smaller screens the Inspector collapses first (xl), then the Explorer
 * (md), each into a drawer opened from the main toolbar.
 */
export function WorkspaceShell({
  explorer,
  inspector,
  children,
}: {
  explorer: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
}) {
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  return (
    <div className="flex h-[calc(100dvh-4rem)]">
      <aside
        aria-label="Object Explorer"
        className="hidden w-72 shrink-0 overflow-y-auto border-r bg-surface md:block"
      >
        {explorer}
      </aside>
      <main aria-label="Analysis workspace" className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-surface/95 px-3 py-2 backdrop-blur">
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setExplorerOpen(true)}
          >
            <PanelLeft aria-hidden /> Objects
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="xl:hidden"
            onClick={() => setInspectorOpen(true)}
          >
            <PanelRight aria-hidden /> Inspector
          </Button>
        </div>
        {children}
      </main>
      <aside
        aria-label="Inspector"
        className="hidden w-80 shrink-0 overflow-y-auto border-l bg-surface xl:block"
      >
        {inspector}
      </aside>
      {explorerOpen && (
        <Sheet open onOpenChange={setExplorerOpen}>
          <SheetContent side="left" className="w-[min(22rem,calc(100vw-2rem))] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Object Explorer</SheetTitle>
              <SheetDescription>PL/SQL object navigation</SheetDescription>
            </SheetHeader>
            {explorer}
          </SheetContent>
        </Sheet>
      )}
      {inspectorOpen && (
        <Sheet open onOpenChange={setInspectorOpen}>
          <SheetContent side="right" className="w-[min(22rem,calc(100vw-2rem))] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Inspector</SheetTitle>
              <SheetDescription>Selected object and dependency details</SheetDescription>
            </SheetHeader>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
