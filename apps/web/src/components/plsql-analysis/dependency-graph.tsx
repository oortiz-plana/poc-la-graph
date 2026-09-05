"use client";

import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";
import type { PlsqlObjectKind, PlsqlRelationship } from "@/lib/contracts";

export type GraphNode = {
  id: string;
  label: string;
  kind: PlsqlObjectKind;
  focused?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: PlsqlRelationship;
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function toElements(nodes: GraphNode[], edges: GraphEdge[]) {
  return [
    ...nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        kind: node.kind,
        focused: node.focused ? "true" : undefined,
      },
    })),
    ...edges.map((edge) => ({
      data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label },
    })),
  ];
}

/**
 * Reusable Cytoscape view for dependency topology. Rebuilds elements in
 * place so viewport state (pan/zoom) survives expansions; taps bubble up to
 * the panel through callbacks.
 */
export function DependencyGraph({
  nodes,
  edges,
  onSelectNode,
  onSelectEdge,
  ariaLabel = "Dependency graph",
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | undefined>(undefined);
  const selectNodeRef = useRef(onSelectNode);
  const selectEdgeRef = useRef(onSelectEdge);
  selectNodeRef.current = onSelectNode;
  selectEdgeRef.current = onSelectEdge;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const primary = cssVar("--color-primary", "#2563eb");
    const muted = cssVar("--color-text-secondary", "#64748b");
    const cy = cytoscape({
      container,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": muted,
            color: primary,
            "text-wrap": "wrap",
            "text-max-width": "10rem",
            "font-size": "0.7rem",
            "text-valign": "center",
            "text-halign": "center",
            width: "0.6rem",
            height: "0.6rem",
          },
        },
        {
          selector: "node[focused]",
          style: { "background-color": primary, width: "0.9rem", height: "0.9rem" },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "font-size": "0.6rem",
            color: muted,
            "line-color": muted,
            "target-arrow-color": muted,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            width: 1,
          },
        },
      ],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.2 },
    });
    cy.on("tap", "node", (event) => selectNodeRef.current?.(event.target.id()));
    cy.on("tap", "edge", (event) => selectEdgeRef.current?.(event.target.id()));
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // Keep the user's viewport across expansions: relayout, then restore.
    const pan = cy.pan();
    const zoom = cy.zoom();
    cy.elements().remove();
    cy.add(toElements(nodes, edges) as never);
    const layout = cy.layout({
      name: "breadthfirst",
      directed: true,
      spacingFactor: 1.2,
    });
    layout.one("layoutstop", () => {
      cy.pan(pan);
      cy.zoom(zoom);
    });
    layout.run();
  }, [nodes, edges]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="h-[26rem] w-full rounded-lg border bg-background"
    />
  );
}
