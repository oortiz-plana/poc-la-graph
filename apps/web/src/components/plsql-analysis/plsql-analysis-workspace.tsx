"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApplicationShell } from "@/components/application-shell";
import { AnalysisHealth } from "./analysis-health";
import { TabsContent } from "@/components/ui/tabs";
import { getPlsqlObject, type PlsqlProblemCode } from "@/lib/api";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { AnalysisError, problemCodeOf } from "./analysis-error";
import { DependencyPathsSection } from "./dependency-paths";
import { DependenciesPanel } from "./dependencies-panel";
import { ImpactReport } from "./impact-report";
import { InspectorPanel, type Inspection } from "./inspector-panel";
import { ObjectExplorer } from "./object-explorer";
import { OverviewPanel } from "./overview-panel";
import { ObjectHeader, ObjectTabs, type PlsqlTab } from "./object-header";
import type { PlsqlLocation } from "./plsql-location";
import { SourceViewer, type SourceRequest } from "./source-viewer";
import { usePlsqlHistory } from "./use-plsql-history";
import { WorkspaceShell } from "./workspace-shell";

/** A reference is a slim projection of an object; pad it to the full shape the object views expect. */
function referenceToObject(reference: PlsqlObjectReference): PlsqlObject {
  return {
    id: reference.id,
    kind: reference.kind,
    name: reference.name,
    schema: reference.schema,
    qualifiedName: reference.qualifiedName,
    projectId: "",
    owner: null,
    signature: null,
    returnType: null,
    declaration: null,
  };
}

function objectSourceRequest(objectId: string): SourceRequest {
  return { kind: "object", objectId };
}

/** Outcome of resolving the object named by the URL (a shared link, reload or Back/Forward). */
type Restore =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; code?: PlsqlProblemCode };

export function PlsqlAnalysisWorkspace() {
  const auth = useAuth();
  const [selected, setSelected] = useState<PlsqlObject>();
  const [tab, setTab] = useState<PlsqlTab>("overview");
  const [sourceRequest, setSourceRequest] = useState<SourceRequest>();
  const [inspection, setInspection] = useState<Inspection>();
  const [restore, setRestore] = useState<Restore>({ status: "idle" });
  const [dependenciesCategory, setDependenciesCategory] =
    useState<PlsqlDependencyCategory>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectedRef = useRef<PlsqlObject | undefined>(undefined);
  const knownObjects = useRef(new Map<string, PlsqlObject>());
  const restoreSeq = useRef(0);
  const firstLocation = useRef(true);
  const urlHistory = usePlsqlHistory(applyLocation);

  // The workspace scrolls per pane (Explorer, main, Inspector) inside a
  // fixed-height shell; a document-level scrollbar on top of that means two
  // competing scroll containers, which throws off sticky headers and
  // canvas-sized panels (Monaco, Cytoscape) that size themselves against the
  // viewport at mount. Suppress it for as long as this view is mounted.
  useEffect(() => {
    const { documentElement, body } = document;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  // Browser tabs and history entries are otherwise indistinguishable.
  useEffect(() => {
    if (!selected) return;
    const previousTitle = document.title;
    document.title = `${selected.name} · ${previousTitle}`;
    return () => {
      document.title = previousTitle;
    };
  }, [selected]);

  function focusHeading() {
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function showObject(
    object: PlsqlObject,
    nextTab: PlsqlTab,
    options: { focus: boolean },
  ) {
    knownObjects.current.set(object.id, object);
    selectedRef.current = object;
    setSelected(object);
    setSourceRequest(
      nextTab === "source" ? objectSourceRequest(object.id) : undefined,
    );
    setInspection({ kind: "object", object });
    if (options.focus) focusHeading();
  }

  /** Applies the object and tab named by the URL; also runs on mount and on Back/Forward. */
  async function applyLocation({ objectId, tab: nextTab }: PlsqlLocation) {
    const initial = firstLocation.current;
    firstLocation.current = false;
    const seq = ++restoreSeq.current;
    setTab(nextTab);
    setDependenciesCategory(undefined);
    if (!objectId) {
      selectedRef.current = undefined;
      setSelected(undefined);
      setInspection(undefined);
      setSourceRequest(undefined);
      setRestore({ status: "idle" });
      return;
    }
    if (selectedRef.current?.id === objectId) {
      setRestore({ status: "idle" });
      return;
    }
    const known = knownObjects.current.get(objectId);
    if (known) {
      showObject(known, nextTab, { focus: !initial });
      setRestore({ status: "idle" });
      return;
    }
    setRestore({ status: "loading" });
    try {
      const object = await getPlsqlObject(objectId);
      if (seq !== restoreSeq.current) return;
      if (!object) {
        setRestore({ status: "notFound" });
        return;
      }
      showObject(object, nextTab, { focus: !initial });
      setRestore({ status: "idle" });
    } catch (error: unknown) {
      if (seq !== restoreSeq.current) return;
      setRestore({ status: "error", code: problemCodeOf(error) });
    }
  }

  function retryRestore() {
    void applyLocation({
      objectId:
        new URLSearchParams(window.location.search).get("object") ?? undefined,
      tab,
    });
  }

  function clearRestore() {
    urlHistory.commit({ tab: "overview" }, "replace");
    void applyLocation({ tab: "overview" });
  }

  /** Switches the visible tab and keeps the URL on the same view without adding a history entry. */
  function showTab(next: PlsqlTab) {
    setTab(next);
    if (selected)
      urlHistory.commit({ objectId: selected.id, tab: next }, "replace");
  }

  function navigate(object: PlsqlObject, nextTab: PlsqlTab = tab) {
    const sameObject = object.id === selectedRef.current?.id;
    urlHistory.commit(
      { objectId: object.id, tab: nextTab },
      sameObject ? "replace" : "push",
    );
    setTab(nextTab);
    showObject(object, nextTab, { focus: true });
  }

  function openReference(reference: PlsqlObjectReference) {
    navigate(referenceToObject(reference));
  }

  /**
   * Shows an object's details in the Inspector without navigating the
   * primary view. Used where clicking a node is exploratory (e.g. a route's
   * intermediate hops) and switching the analyzed object would discard
   * in-progress state, unlike `openReference`'s full navigation.
   */
  function inspectReference(reference: PlsqlObjectReference) {
    setInspection({ kind: "object", object: referenceToObject(reference) });
  }

  function inspectEdge(edge: PlsqlDependency) {
    setInspection({ kind: "edge", edge });
  }

  /** Navigates to a related object and lands on a specific one of its tabs. */
  function openObjectAt(reference: PlsqlObjectReference, next: PlsqlTab) {
    navigate(referenceToObject(reference), next);
  }

  /**
   * The Inspector's one deliberate way out: clicking an object's name there
   * navigates to its Overview, unlike inspecting a trail node in place.
   */
  function openObjectOverview(reference: PlsqlObjectReference) {
    openObjectAt(reference, "overview");
  }

  /** Overview's drill-down action: go analyze the related object itself. */
  function analyzeObject(reference: PlsqlObjectReference) {
    openObjectAt(reference, "impact");
  }

  /** Opens Dependencies with a category pre-applied, e.g. from an Overview metric. */
  function exploreDependencies(category: PlsqlDependencyCategory) {
    setDependenciesCategory(category);
    showTab("dependencies");
  }

  /** Tab-bar selection. Source needs a request, or the tab would open empty. */
  function changeTab(next: PlsqlTab) {
    setDependenciesCategory(undefined);
    if (next === "source" && selected) {
      setSourceRequest(
        (current) => current ?? objectSourceRequest(selected.id),
      );
    }
    showTab(next);
  }

  function openEvidence(evidence: PlsqlSourceCoordinate | null) {
    if (!evidence?.sourceFileId) return;
    setSourceRequest({
      kind: "file",
      fileId: evidence.sourceFileId,
      startLine: evidence.startLine ?? undefined,
      endLine: evidence.startLine ?? undefined,
    });
    showTab("source");
  }

  /** Header shortcut: always opens the selected object's own source. */
  function selectTab(next: PlsqlTab) {
    if (next === "source" && selected) {
      setSourceRequest(objectSourceRequest(selected.id));
    }
    setDependenciesCategory(undefined);
    showTab(next);
  }

  return (
    <ApplicationShell defaultSidebarOpen={false}>
      {!auth.config.plsqlEnabled ? (
        <div className="p-4 sm:p-6 lg:p-8">
          <h1 className="text-2xl font-semibold">PL/SQL analysis</h1>
          <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
            Analysis is not configured
          </p>
        </div>
      ) : (
        <WorkspaceShell
          hasInspection={inspection !== undefined}
          explorer={({ closeDrawer }) => (
            <ObjectExplorer
              selectedId={selected?.id}
              onSelect={(object) => {
                navigate(object);
                closeDrawer?.();
              }}
            />
          )}
          inspector={
            <InspectorPanel
              inspection={inspection}
              onOpenObject={openObjectOverview}
            />
          }
        >
          {({ openExplorer }) =>
            selected ? (
              <div className="mx-auto max-w-[75rem] p-4 sm:p-6">
                <ObjectHeader
                  object={selected}
                  onSelectTab={selectTab}
                  headingRef={headingRef}
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Back"
                        disabled={!urlHistory.canGoBack}
                        onClick={urlHistory.back}
                      >
                        <ArrowLeft aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Forward"
                        disabled={!urlHistory.canGoForward}
                        onClick={urlHistory.forward}
                      >
                        <ArrowRight aria-hidden />
                      </Button>
                      <AnalysisHealth
                        objectId={selected.id}
                        onOpenEvidence={openEvidence}
                      />
                    </>
                  }
                />
                <ObjectTabs value={tab} onChange={changeTab}>
                  <TabsContent value="overview">
                    <OverviewPanel
                      object={selected}
                      onOpenEvidence={openEvidence}
                      onOpenObject={openReference}
                      onInspectObject={inspectReference}
                      onInspectEdge={inspectEdge}
                      onInspectPath={(path) =>
                        setInspection({ kind: "path", path })
                      }
                      onAnalyzeObject={analyzeObject}
                      onExploreDependencies={exploreDependencies}
                      onExploreImpact={() => changeTab("impact")}
                    />
                  </TabsContent>
                  <TabsContent value="dependencies">
                    <DependenciesPanel
                      object={selected}
                      initialCategory={dependenciesCategory}
                      onOpenEvidence={openEvidence}
                      onOpenObject={openReference}
                      onInspectObject={inspectReference}
                      onInspectEdge={inspectEdge}
                      onAnalyzeObject={analyzeObject}
                      onInspectPath={(path) =>
                        setInspection({ kind: "path", path })
                      }
                    />
                  </TabsContent>
                  <TabsContent value="impact">
                    <ImpactReport
                      objectId={selected.id}
                      onOpenEvidence={openEvidence}
                      onOpenObject={openReference}
                      onInspectObject={inspectReference}
                      onInspectEdge={inspectEdge}
                      onInspectPath={(path) =>
                        setInspection({ kind: "path", path })
                      }
                    />
                  </TabsContent>
                  <TabsContent value="paths">
                    <DependencyPathsSection
                      initialFrom={selected}
                      onInspectObject={inspectReference}
                      onOpenEvidence={openEvidence}
                      onInspectPath={(path) =>
                        setInspection({ kind: "path", path })
                      }
                      onInspectEdge={inspectEdge}
                      onOpenObject={openReference}
                      onAnalyzeObject={analyzeObject}
                    />
                  </TabsContent>
                  <TabsContent value="source">
                    {sourceRequest ? (
                      <SourceViewer
                        request={sourceRequest}
                        onClose={() => setSourceRequest(undefined)}
                      />
                    ) : (
                      <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                        Open an object or follow a source location to view it.
                      </p>
                    )}
                  </TabsContent>
                </ObjectTabs>
              </div>
            ) : (
              <div className="mx-auto max-w-[75rem] p-4 sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h1 className="text-2xl font-semibold">PL/SQL analysis</h1>
                  <AnalysisHealth onOpenEvidence={openEvidence} />
                </div>
                <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                  Choose an object in the Object Explorer to inspect its
                  dependencies, impact, paths, and source.
                </p>
                <EmptyState
                  restore={restore}
                  onBrowse={openExplorer}
                  onRetry={retryRestore}
                  onClear={clearRestore}
                />
              </div>
            )
          }
        </WorkspaceShell>
      )}
    </ApplicationShell>
  );
}

function EmptyState({
  restore,
  onBrowse,
  onRetry,
  onClear,
}: {
  restore: Restore;
  onBrowse: () => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  if (restore.status === "loading") {
    return (
      <div role="status" aria-label="Loading object" className="mt-6 space-y-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (restore.status === "error") {
    return (
      <div className="mt-6">
        <AnalysisError code={restore.code} onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
      <p>
        {restore.status === "notFound"
          ? "The linked object was not found in the analyzed corpus."
          : "No object selected"}
      </p>
      <Button
        className="mt-4"
        variant={restore.status === "notFound" ? "outline" : "default"}
        onClick={restore.status === "notFound" ? onClear : onBrowse}
      >
        <Search aria-hidden />
        {restore.status === "notFound" ? "Clear selection" : "Browse objects"}
      </Button>
    </div>
  );
}
