"use client";

import { ChevronLeft, ChevronRight, PanelLeft, PanelRight } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Three-pane PL/SQL workspace: Object Explorer (contextual code navigation),
 * main analysis area, and Inspector (secondary details). The application
 * sidebar stays outside this component, so its own collapse (a real
 * shadcn Sidebar, see `application-shell.tsx`) is unaffected by anything here.
 *
 * Explorer and Inspector are each a real shadcn `Sidebar`/`SidebarProvider`
 * pair too, docked at the md breakpoint. They aren't page-level sidebars
 * though (they sit nested inside the main content area, below the app's own
 * header and next to the app's own nav sidebar), so each one's `Sidebar`
 * uses `forceDesktop` (skip the built-in mobile Sheet swap — this pane has
 * its own, see below) plus a `!absolute` position override anchored to a
 * `relative` wrapper local to this layout, instead of the library default of
 * `fixed`-to-the-viewport. Each pane also disables the library's global
 * cmd/ctrl+B shortcut and uses its own cookie name, since three independent
 * SidebarProviders on one page would otherwise fight over both. Below md,
 * both panes open as a drawer (a plain Sheet, not the Sidebar's own mobile
 * branch, for the same reason) from the main toolbar; the Explorer drawer's
 * content stays mounted once created (hidden via CSS, not unmounted) so its
 * search text, filters, and expanded packages survive closing it. The
 * Inspector holds no state of its own; the object, dependency, and path
 * selections that drive it live in the caller regardless of whether this
 * pane is open.
 */
export function WorkspaceShell({
  explorer,
  inspector,
  hasInspection,
  children,
}: {
  explorer: ReactNode;
  inspector: ReactNode;
  /** Whether there's currently something to show in the Inspector (an
   * object, dependency, or path selected). The Inspector never reserves
   * space, and never offers a toggle, when this is false. */
  hasInspection: boolean;
  children: ReactNode;
}) {
  const [explorerDrawerOpen, setExplorerDrawerOpen] = useState(false);
  const [explorerDrawerMounted, setExplorerDrawerMounted] = useState(false);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);

  function openExplorerDrawer() {
    // Mounted once, on first open, then kept mounted (see the Sheet below) so
    // reopening it never loses the search/filter state a user already built up.
    setExplorerDrawerMounted(true);
    setExplorerDrawerOpen(true);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <SidebarProvider
        className="contents"
        keyboardShortcut={false}
        cookieName="plsql_explorer_open"
        style={
          { "--sidebar-width": "clamp(14rem,20vw,20rem)" } as CSSProperties
        }
      >
        <div className="relative h-full shrink-0">
          <Sidebar
            forceDesktop
            collapsible="offcanvas"
            aria-label="Object Explorer"
            className="!absolute !inset-y-0 !left-0 !h-full border-r bg-surface"
          >
            <SidebarContent>{explorer}</SidebarContent>
            <PaneToggleButton side="left" label="Object Explorer" />
          </Sidebar>
        </div>
      </SidebarProvider>
      <main
        aria-label="Analysis workspace"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-surface/95 px-3 py-2 backdrop-blur">
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={openExplorerDrawer}
          >
            <PanelLeft aria-hidden /> Objects
          </Button>
          <span className="flex-1" />
          {hasInspection && (
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => setInspectorDrawerOpen(true)}
            >
              <PanelRight aria-hidden /> Inspector
            </Button>
          )}
        </div>
        {children}
      </main>
      {hasInspection && (
        <SidebarProvider
          className="contents"
          keyboardShortcut={false}
          cookieName="plsql_inspector_open"
          style={
            { "--sidebar-width": "clamp(16rem,22vw,22rem)" } as CSSProperties
          }
        >
          <div className="relative h-full shrink-0">
            <Sidebar
              forceDesktop
              side="right"
              collapsible="offcanvas"
              aria-label="Inspector"
              className="!absolute !inset-y-0 !right-0 !h-full border-l bg-surface"
            >
              <PaneToggleButton side="right" label="Inspector" />
              <SidebarContent>{inspector}</SidebarContent>
            </Sidebar>
          </div>
        </SidebarProvider>
      )}
      {explorerDrawerMounted && (
        <Sheet open={explorerDrawerOpen} onOpenChange={setExplorerDrawerOpen}>
          <SheetContent
            forceMount
            side="left"
            className={cn(
              "w-[min(22rem,calc(100vw-2rem))] p-0",
              !explorerDrawerOpen && "hidden",
            )}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Object Explorer</SheetTitle>
              <SheetDescription>PL/SQL object navigation</SheetDescription>
            </SheetHeader>
            {explorer}
          </SheetContent>
        </Sheet>
      )}
      {hasInspection && inspectorDrawerOpen && (
        <Sheet open onOpenChange={setInspectorDrawerOpen}>
          <SheetContent
            side="right"
            className="w-[min(22rem,calc(100vw-2rem))] p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Inspector</SheetTitle>
              <SheetDescription>
                Selected object and dependency details
              </SheetDescription>
            </SheetHeader>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** Toggle handle attached to a docked pane's own border edge (not a separate
 * toolbar button), so collapsing it reads as pushing the panel itself
 * closed. Must render inside that pane's own `Sidebar`, whose (overridden)
 * absolute-positioned content div is this button's positioning anchor. */
function PaneToggleButton({
  side,
  label,
}: {
  side: "left" | "right";
  label: string;
}) {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const showChevronRight = side === "left" ? collapsed : !collapsed;

  return (
    <button
      type="button"
      aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
      aria-pressed={!collapsed}
      onClick={toggleSidebar}
      className={cn(
        "absolute top-1/2 z-20 flex h-8 w-4 -translate-y-1/2 items-center justify-center rounded-md border bg-surface text-text-muted hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        side === "left" ? "-right-3" : "-left-3",
      )}
    >
      {showChevronRight ? (
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
