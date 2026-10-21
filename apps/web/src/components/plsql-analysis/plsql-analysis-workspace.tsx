"use client";

import { useTranslations } from "next-intl";
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
import {
  primaryFilter,
  type ObjectFilter,
  type ObjectFilterKey,
} from "./object-filters";
import { WorkspaceLanding } from "./workspace-landing";
import { OverviewPanel } from "./overview-panel";
import { ObjectHeader, ObjectTabs, type PlsqlTab } from "./object-header";
import { InspectedObjectProvider } from "./inspected-object";
import {
  GroupExpansionProvider,
  type GroupExpansion,
} from "./package-grouping";
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
  const t = useTranslations("plsqlWorkspace.workspace");
  const [selected, setSelected] = useState<PlsqlObject>();
  const [tab, setTab] = useState<PlsqlTab>("overview");
  // Workspace-wide: one indicator files the rows of Overview, Dependencies and
  // Impact under package headers, and it stays on while moving between them.
  // Bumped to make the Explorer forget its search, filter and open packages.
  const [explorerReset, setExplorerReset] = useState(0);
  const [filterRequest, setFilterRequest] = useState<
    { id: number; filter: ObjectFilter } | undefined
  >();
  const [groupByPackage, setGroupByPackage] = useState(false);
  const [groupExpansion, setGroupExpansion] = useState<GroupExpansion>({
    mode: "expanded",
    epoch: 0,
  });
  const commandGroups = (mode: GroupExpansion["mode"]) =>
    setGroupExpansion((current) => ({ mode, epoch: current.epoch + 1 }));
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
  // canvas-sized panels (Monaco) that size themselves against the
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

  /**
   * "Browse objects": back to how the console looks right after signing in,
   * with no object selected and an empty Explorer search. It is a history
   * entry of its own, so Back returns to the object that was open.
   */
  function startOver() {
    setExplorerReset((current) => current + 1);
    urlHistory.commit(
      { tab: "overview" },
      selectedRef.current ? "push" : "replace",
    );
    void applyLocation({ tab: "overview" });
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

  /**
   * Shows an object's details in the Inspector without navigating the
   * primary view. Used where clicking a node is exploratory (e.g. a route's
   * intermediate hops) and switching the analyzed object would discard
   * in-progress state, unlike a full navigation.
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

  return (
    <ApplicationShell>
      {!auth.config.plsqlEnabled ? (
        <div className="p-4 sm:p-6 lg:p-8">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
            {t("notConfigured")}
          </p>
        </div>
      ) : (
        <WorkspaceShell
          hasInspection={inspection !== undefined}
          explorer={({ closeDrawer, collapseDocked }) => (
            <ObjectExplorer
              selectedId={selected?.id}
              resetSignal={explorerReset}
              filterRequest={filterRequest}
              onSelect={(object) => {
                navigate(object);
                // Picking an object hands the space to the analysis: the
                // drawer closes and the docked pane folds away (its edge
                // handle, or "Browse objects", brings it back).
                closeDrawer?.();
                collapseDocked?.();
              }}
            />
          )}
          onExplore={startOver}
          toolbarActions={
            <AnalysisHealth
              objectId={selected?.id}
              onOpenEvidence={openEvidence}
            />
          }
          inspector={
            <InspectorPanel
              inspection={inspection}
              onOpenObject={openObjectOverview}
              onAnalyzeObject={analyzeObject}
            />
          }
        >
          {({ openExplorer }) =>
            selected ? (
              <div className="flex min-h-0 w-full flex-1 flex-col p-4 sm:p-6">
                <ObjectHeader
                  object={selected}
                  headingRef={headingRef}
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={t("back")}
                        disabled={!urlHistory.canGoBack}
                        onClick={urlHistory.back}
                      >
                        <ArrowLeft aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={t("forward")}
                        disabled={!urlHistory.canGoForward}
                        onClick={urlHistory.forward}
                      >
                        <ArrowRight aria-hidden />
                      </Button>
                    </>
                  }
                />
                <InspectedObjectProvider
                  value={
                    inspection?.kind === "object"
                      ? inspection.object.id
                      : undefined
                  }
                >
                  <GroupExpansionProvider value={groupExpansion}>
                    <ObjectTabs
                      value={tab}
                      onChange={changeTab}
                      groupByPackage={groupByPackage}
                      onGroupByPackageChange={(next) => {
                        setGroupByPackage(next);
                        // Every time grouping is switched, start with open groups.
                        commandGroups("expanded");
                      }}
                      onExpandAllGroups={() => commandGroups("expanded")}
                      onCollapseAllGroups={() => commandGroups("collapsed")}
                    >
                      <TabsContent value="overview">
                        <OverviewPanel
                          object={selected}
                          groupByPackage={groupByPackage}
                          onOpenEvidence={openEvidence}
                          onInspectObject={inspectReference}
                          onInspectEdge={inspectEdge}
                          onInspectPath={(path) =>
                            setInspection({ kind: "path", path })
                          }
                          onExploreDependencies={exploreDependencies}
                          onExploreImpact={() => changeTab("impact")}
                        />
                      </TabsContent>
                      <TabsContent value="dependencies">
                        <DependenciesPanel
                          object={selected}
                          initialCategory={dependenciesCategory}
                          groupByPackage={groupByPackage}
                          onOpenEvidence={openEvidence}
                          onInspectObject={inspectReference}
                          onInspectEdge={inspectEdge}
                          onInspectPath={(path) =>
                            setInspection({ kind: "path", path })
                          }
                        />
                      </TabsContent>
                      <TabsContent value="impact">
                        <ImpactReport
                          objectId={selected.id}
                          groupByPackage={groupByPackage}
                          onOpenEvidence={openEvidence}
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
                        />
                      </TabsContent>
                      <TabsContent
                        value="source"
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        {sourceRequest ? (
                          <SourceViewer
                            request={sourceRequest}
                            onClose={() => setSourceRequest(undefined)}
                          />
                        ) : (
                          <div className="mt-3 rounded-lg border border-dashed p-4 text-sm text-text-secondary">
                            <p>{t("openSourcePrompt")}</p>
                            <Button
                              className="mt-3"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setSourceRequest(
                                  objectSourceRequest(selected.id),
                                )
                              }
                            >
                              {t("showSourceOf", { name: selected.name })}
                            </Button>
                          </div>
                        )}
                      </TabsContent>
                    </ObjectTabs>
                  </GroupExpansionProvider>
                </InspectedObjectProvider>
              </div>
            ) : (
              <div className="mx-auto min-h-0 w-full max-w-[75rem] flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <h1 className="text-2xl font-semibold">{t("title")}</h1>
                <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                  {t("intro")}
                </p>
                <EmptyState
                  restore={restore}
                  onBrowseKind={(key) => {
                    setFilterRequest((current) => ({
                      id: (current?.id ?? 0) + 1,
                      filter: primaryFilter(key),
                    }));
                    openExplorer();
                  }}
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
  onBrowseKind,
  onRetry,
  onClear,
}: {
  restore: Restore;
  onBrowseKind: (key: ObjectFilterKey) => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("plsqlWorkspace.workspace");
  if (restore.status === "loading") {
    return (
      <div
        role="status"
        aria-label={t("loadingObject")}
        className="mt-6 space-y-3"
      >
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
  if (restore.status === "notFound") {
    return (
      <div className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
        <p>{t("notFound")}</p>
        <Button className="mt-4" variant="outline" onClick={onClear}>
          <Search aria-hidden />
          {t("clearSelection")}
        </Button>
      </div>
    );
  }
  return <WorkspaceLanding onBrowseKind={onBrowseKind} />;
}
