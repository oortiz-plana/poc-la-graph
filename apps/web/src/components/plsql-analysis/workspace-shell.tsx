"use client";

import { ChevronLeft, ChevronRight, PanelRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SidebarContent,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Three-pane PL/SQL workspace: Object Explorer (contextual code navigation),
 * main analysis area, and Inspector (secondary details). The application
 * sidebar stays outside this component, so its own collapse (a real shadcn
 * Sidebar, see `application-shell.tsx`) is unaffected by anything here.
 *
 * Explorer and Inspector each get their own `SidebarProvider`, so their open
 * state and toggle share the exact same library the app's own sidebar uses
 * (`useSidebar`). They aren't page-level sidebars though — they sit nested
 * inside the main content area, next to the app's own sidebar and below its
 * header — so unlike `<Sidebar>` they render as a plain docked `<aside>`
 * (`DockedPane` below) instead of the library's viewport-fixed panel, which
 * doesn't fit a nested pane. Each provider also passes `desktopOnly` (this
 * pane has its own drawer for narrow screens below, not the library's
 * built-in mobile Sheet, so `toggleSidebar` must always flip the real `open`
 * state rather than the otherwise-unused `openMobile` one), disables the
 * global cmd/ctrl+B shortcut, and uses its own cookie name — three
 * independent SidebarProviders on one page would otherwise fight over both.
 * The Explorer docks from lg and the Inspector from xl; below those widths a
 * pane opens as a drawer (a plain Sheet) from the main toolbar, so the
 * analysis area is never squeezed into a few dozen pixels. The Explorer
 * drawer's content stays mounted once created (hidden via CSS, not unmounted)
 * so its search text, filters, and expanded packages survive closing it. The Inspector holds no state of its own; the object,
 * dependency, and path selections that drive it live in the caller
 * regardless of whether this pane is open.
 */
type WorkspaceShellControls = {
  /** Focuses the docked Explorer search, or opens the Explorer drawer when it is not docked. */
  openExplorer: () => void;
  /**
   * Starts over: the caller clears the selection and the Explorer's search,
   * then the Explorer is opened (expanded if collapsed) with the search
   * focused. This is what the toolbar's always-visible button does.
   */
  explore: () => void;
};

type DockControls = { setOpen: (open: boolean) => void };

/** What the Explorer render function can do to its own pane. */
type ExplorerControls = {
  /** Present in the narrow-screen drawer: closes it. */
  closeDrawer?: () => void;
  /** Present in the docked pane: collapses it, e.g. after an object is picked. */
  collapseDocked?: () => void;
};

export function WorkspaceShell({
  explorer,
  inspector,
  hasInspection,
  onExplore,
  toolbarActions,
  children,
}: {
  explorer: (controls: ExplorerControls) => ReactNode;
  /** Called by the toolbar's "Browse objects" button before the Explorer opens, to reset the view. */
  onExplore?: () => void;
  inspector: ReactNode;
  /** Always-visible actions at the toolbar's trailing edge, before the Inspector toggle. */
  toolbarActions?: ReactNode;
  /** Whether there's currently something to show in the Inspector (an
   * object, dependency, or path selected). The Inspector never reserves
   * space, and never offers a toggle, when this is false. */
  hasInspection: boolean;
  children: ReactNode | ((controls: WorkspaceShellControls) => ReactNode);
}) {
  const t = useTranslations("plsqlWorkspace.shell");
  const [explorerDrawerOpen, setExplorerDrawerOpen] = useState(false);
  const [explorerDrawerMounted, setExplorerDrawerMounted] = useState(false);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const objectsButtonRef = useRef<HTMLButtonElement>(null);
  const dockedExplorerRef = useRef<HTMLElement>(null);
  const drawerExplorerRef = useRef<HTMLDivElement>(null);
  const dockControlsRef = useRef<DockControls | undefined>(undefined);

  function openExplorerDrawer() {
    // Mounted once, on first open, then kept mounted (see the Sheet below) so
    // reopening it never loses the search/filter state a user already built up.
    setExplorerDrawerMounted(true);
    setExplorerDrawerOpen(true);
  }

  function closeExplorerDrawer(restoreFocus: boolean) {
    setExplorerDrawerOpen(false);
    // The drawer stays mounted (hidden), so Radix cannot hand focus back on
    // its own; without this the focus would fall to <body>.
    if (restoreFocus)
      window.setTimeout(() => objectsButtonRef.current?.focus(), 0);
  }

  function focusSearchIn(container: HTMLElement | null) {
    container?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }

  /** Reset the view, then open the Explorer ready for typing. */
  function explore() {
    onExplore?.();
    const docked = window.matchMedia?.("(min-width: 1024px)")?.matches ?? false;
    if (docked) {
      dockControlsRef.current?.setOpen(true);
      // The pane may have been collapsed (display: none) a moment ago.
      window.setTimeout(() => focusSearchIn(dockedExplorerRef.current), 50);
    } else {
      openExplorerDrawer();
      window.setTimeout(() => focusSearchIn(drawerExplorerRef.current), 100);
    }
  }

  function openExplorer() {
    const search = dockedExplorerRef.current?.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    if (search && search.offsetParent !== null) search.focus();
    else openExplorerDrawer();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <SidebarProvider
        className="contents"
        desktopOnly
        keyboardShortcut={false}
        cookieName="plsql_explorer_open"
      >
        <DockedPane
          side="left"
          label={t("objectExplorer")}
          width="clamp(14rem,20vw,20rem)"
          dockFrom="lg"
          paneRef={dockedExplorerRef}
          skipTo="plsql-workspace"
          controlsRef={dockControlsRef}
        >
          {explorer({
            collapseDocked: () => dockControlsRef.current?.setOpen(false),
          })}
        </DockedPane>
      </SidebarProvider>
      <section
        id="plsql-workspace"
        tabIndex={-1}
        aria-label={t("analysisWorkspace")}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-none"
      >
        <div className="z-10 flex shrink-0 items-center justify-between gap-2 border-b bg-surface/95 px-3 py-1.5 backdrop-blur">
          <Button
            ref={objectsButtonRef}
            variant="outline"
            size="sm"
            onClick={explore}
          >
            <Search aria-hidden /> {t("explore")}
          </Button>
          <span className="flex-1" />
          {toolbarActions}
          {hasInspection && (
            <Button
              variant="outline"
              size="sm"
              className="xl:hidden"
              onClick={() => setInspectorDrawerOpen(true)}
            >
              <PanelRight aria-hidden /> {t("inspector")}
            </Button>
          )}
        </div>
        {typeof children === "function"
          ? children({ openExplorer, explore })
          : children}
      </section>
      {hasInspection && (
        <SidebarProvider
          className="contents"
          desktopOnly
          keyboardShortcut={false}
          cookieName="plsql_inspector_open"
        >
          <DockedPane
            side="right"
            label={t("inspector")}
            width="clamp(16rem,22vw,22rem)"
            dockFrom="xl"
          >
            {inspector}
          </DockedPane>
        </SidebarProvider>
      )}
      {explorerDrawerMounted && (
        <Sheet
          open={explorerDrawerOpen}
          onOpenChange={(open) =>
            open ? setExplorerDrawerOpen(true) : closeExplorerDrawer(true)
          }
        >
          <SheetContent
            forceMount
            side="left"
            className={cn(
              "flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-0 p-0",
              !explorerDrawerOpen && "hidden",
            )}
          >
            <SheetHeader className="min-h-[4.875rem] shrink-0 justify-center space-y-0 border-b px-4 pr-16">
              <SheetTitle className="text-base">
                {t("objectExplorer")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("explorerDescription")}
              </SheetDescription>
            </SheetHeader>
            <div ref={drawerExplorerRef} className="min-h-0 flex-1">
              {explorer({ closeDrawer: () => closeExplorerDrawer(false) })}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {hasInspection && inspectorDrawerOpen && (
        <Sheet open onOpenChange={setInspectorDrawerOpen}>
          <SheetContent
            side="right"
            className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-0 p-0"
          >
            <SheetHeader className="min-h-[4.875rem] shrink-0 justify-center space-y-0 border-b px-4 pr-16">
              <SheetTitle className="text-base">{t("inspector")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("inspectorDescription")}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * A docked pane plus its own boundary-handle toggle, both driven by the
 * nearest `SidebarProvider`'s `useSidebar()` — the same state/context the
 * app's own Sidebar uses, just rendered as a simple show/hide `<aside>`
 * (docked panes aren't page-level, so the library's own `<Sidebar>` — fixed
 * to the viewport — doesn't fit here) instead of that component's own
 * markup.
 */
const DOCK_CLASSES = {
  lg: { pane: "lg:block", toggle: "lg:flex" },
  xl: { pane: "xl:block", toggle: "xl:flex" },
} as const;

function DockedPane({
  side,
  label,
  width,
  dockFrom,
  paneRef,
  skipTo,
  controlsRef,
  children,
}: {
  side: "left" | "right";
  label: string;
  width: string;
  /** Breakpoint from which the pane is docked; narrower screens use a drawer. */
  dockFrom: keyof typeof DOCK_CLASSES;
  paneRef?: RefObject<HTMLElement | null>;
  /** Id of an element a keyboard user can jump to past this pane's controls. */
  skipTo?: string;
  /** Receives this pane's open/close setter so the shell can drive it. */
  controlsRef?: RefObject<DockControls | undefined>;
  children: ReactNode;
}) {
  const t = useTranslations("plsqlWorkspace.shell");
  const { state, toggleSidebar, setOpen } = useSidebar();
  useEffect(() => {
    if (controlsRef) controlsRef.current = { setOpen };
  }, [controlsRef, setOpen]);
  const collapsed = state === "collapsed";
  const showChevronRight = side === "left" ? collapsed : !collapsed;

  const pane = (
    <aside
      key="pane"
      ref={paneRef}
      aria-label={label}
      data-state={state}
      style={collapsed ? undefined : { width }}
      className={cn(
        "relative min-h-0 shrink-0 overflow-hidden bg-surface",
        side === "left" ? "border-r" : "border-l",
        collapsed ? "hidden" : cn("hidden", DOCK_CLASSES[dockFrom].pane),
      )}
    >
      {skipTo && (
        <a
          href={`#${skipTo}`}
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:border focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-primary"
        >
          {t("skipToWorkspace")}
        </a>
      )}
      <SidebarContent className="h-full overflow-y-auto">
        {children}
      </SidebarContent>
    </aside>
  );
  // Boundary handle: part of the pane's own edge rather than a separate
  // toolbar button, so collapsing it reads as pushing the panel itself
  // closed. Sits between the pane and the main content — before it for a
  // right-side pane, after it for a left-side one.
  const toggle = (
    <button
      key="toggle"
      type="button"
      aria-label={collapsed ? t("show", { label }) : t("hide", { label })}
      aria-pressed={!collapsed}
      onClick={toggleSidebar}
      className={cn(
        "hidden w-3 shrink-0 items-center justify-center bg-surface text-text-muted hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        DOCK_CLASSES[dockFrom].toggle,
        side === "left" ? "border-r" : "border-l",
      )}
    >
      {showChevronRight ? (
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
      )}
    </button>
  );

  return side === "left" ? (
    <>
      {pane}
      {toggle}
    </>
  ) : (
    <>
      {toggle}
      {pane}
    </>
  );
}
