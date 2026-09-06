"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationShell } from "@/components/application-shell";
import { AnalysisHealth } from "./analysis-health";
import { TabsContent } from "@/components/ui/tabs";
import type {
  PlsqlDependency,
  PlsqlDependencyCategory,
  PlsqlObject,
  PlsqlObjectReference,
  PlsqlSourceCoordinate,
} from "@/lib/contracts";
import { useAuth } from "../auth-provider";
import { DependencyPathsSection } from "./dependency-paths";
import { DependenciesPanel } from "./dependencies-panel";
import { ImpactReport } from "./impact-report";
import { InspectorPanel, type Inspection } from "./inspector-panel";
import { ObjectExplorer } from "./object-explorer";
import { OverviewPanel } from "./overview-panel";
import { ObjectHeader, ObjectTabs, type PlsqlTab } from "./object-header";
import { SourceViewer, type SourceRequest } from "./source-viewer";
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

export function PlsqlAnalysisWorkspace() {
  const auth = useAuth();
  const [selected, setSelected] = useState<PlsqlObject>();
  const [tab, setTab] = useState<PlsqlTab>("overview");
  const [sourceRequest, setSourceRequest] = useState<SourceRequest>();
  const [inspection, setInspection] = useState<Inspection>();
  const [history, setHistory] = useState<PlsqlObject[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [dependenciesCategory, setDependenciesCategory] =
    useState<PlsqlDependencyCategory>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  function navigate(object: PlsqlObject) {
    selectObject(object);
    setHistory((current) => [...current.slice(0, historyIndex + 1), object]);
    setHistoryIndex((index) => index + 1);
  }

  function moveHistory(offset: -1 | 1) {
    const nextIndex = historyIndex + offset;
    const target = history[nextIndex];
    if (!target) return;
    setHistoryIndex(nextIndex);
    selectObject(target);
  }

  function focusHeading() {
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function selectObject(object: PlsqlObject) {
    setSelected(object);
    setSourceRequest(undefined);
    setInspection({ kind: "object", object });
    focusHeading();
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
    navigate(referenceToObject(reference));
    setTab(next);
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
    setTab("dependencies");
  }

  function changeTab(next: PlsqlTab) {
    setDependenciesCategory(undefined);
    setTab(next);
  }

  function openEvidence(evidence: PlsqlSourceCoordinate | null) {
    if (!evidence?.sourceFileId) return;
    setSourceRequest({
      kind: "file",
      fileId: evidence.sourceFileId,
      startLine: evidence.startLine ?? undefined,
      endLine: evidence.startLine ?? undefined,
    });
    setTab("source");
  }

  function selectTab(next: PlsqlTab) {
    changeTab(next);
    if (next === "source" && selected) {
      setSourceRequest({ kind: "object", objectId: selected.id });
    }
  }

  return (
    <ApplicationShell>
      {!auth.config.plsqlEnabled ? (
        <div className="p-4 sm:p-6 lg:p-8">
          <h1 className="text-2xl font-semibold">PL/SQL analysis</h1>
          <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
            Analysis is not configured
          </p>
        </div>
      ) : (
        <WorkspaceShell
          explorer={
            <ObjectExplorer selectedId={selected?.id} onSelect={navigate} />
          }
          inspector={
            <InspectorPanel
              inspection={inspection}
              onOpenObject={openObjectOverview}
            />
          }
        >
          {selected ? (
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
                      disabled={historyIndex <= 0}
                      onClick={() => moveHistory(-1)}
                    >
                      <ArrowLeft aria-hidden />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Forward"
                      disabled={historyIndex >= history.length - 1}
                      onClick={() => moveHistory(1)}
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
              <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-text-secondary">
                No object selected
              </p>
            </div>
          )}
        </WorkspaceShell>
      )}
    </ApplicationShell>
  );
}
