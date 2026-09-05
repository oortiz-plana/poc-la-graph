import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DependencyGraph, type GraphEdge, type GraphNode } from "./dependency-graph";
import { ViewModeToggle } from "./view-mode-toggle";

const cyMock = vi.hoisted(() => ({
  on: vi.fn(),
  destroy: vi.fn(),
  elements: vi.fn(() => ({ remove: vi.fn() })),
  add: vi.fn(),
  layout: vi.fn(() => ({ run: vi.fn(), one: vi.fn() })),
  pan: vi.fn(() => ({ x: 10, y: 20 })),
  zoom: vi.fn(() => 1.5),
}));
vi.mock("cytoscape", () => ({
  default: vi.fn(() => cyMock),
}));

import cytoscape from "cytoscape";
import { addedElements, resetCytoscapeMock } from "./cytoscape-mock";

const nodes: GraphNode[] = [
  { id: "n1", label: "HR.DOCU_FIDE", kind: "Function", focused: true },
  { id: "n2", label: "HR.CALC_IVA_MORA", kind: "Function" },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "n2", target: "n1", label: "CALLS" },
];

describe("DependencyGraph", () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetCytoscapeMock(cyMock);
  });

  it("initializes cytoscape once and adds elements with focus markers", () => {
    render(
      <DependencyGraph nodes={nodes} edges={edges} onSelectNode={vi.fn()} onSelectEdge={vi.fn()} />,
    );
    expect(screen.getByRole("img", { name: "Dependency graph" })).toBeInTheDocument();
    expect(cytoscape).toHaveBeenCalledTimes(1);
    expect(cyMock.on).toHaveBeenCalledWith("tap", "node", expect.any(Function));
    expect(cyMock.on).toHaveBeenCalledWith("tap", "edge", expect.any(Function));
    const added = addedElements(cyMock);
    expect(added).toHaveLength(3);
    expect(added[0].data).toMatchObject({
      id: "n1",
      label: "HR.DOCU_FIDE",
      focused: "true",
    });
    expect(added[2].data).toMatchObject({ id: "e1", source: "n2", target: "n1", label: "CALLS" });
  });

  it("forwards node and edge taps to callbacks", () => {
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();
    render(
      <DependencyGraph nodes={nodes} edges={edges} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />,
    );
    const nodeHandler = (cyMock.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[1] === "node",
    )![2] as (event: { target: { id: () => string } }) => void;
    const edgeHandler = (cyMock.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[1] === "edge",
    )![2] as (event: { target: { id: () => string } }) => void;
    nodeHandler({ target: { id: () => "n2" } });
    edgeHandler({ target: { id: () => "e1" } });
    expect(onSelectNode).toHaveBeenCalledWith("n2");
    expect(onSelectEdge).toHaveBeenCalledWith("e1");
  });
});

describe("ViewModeToggle", () => {
  it("toggles between graph and list modes", () => {
    const onChange = vi.fn();
    render(<ViewModeToggle mode="list" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "false");
    screen.getByRole("button", { name: "Graph" }).click();
    expect(onChange).toHaveBeenCalledWith("graph");
  });
});
