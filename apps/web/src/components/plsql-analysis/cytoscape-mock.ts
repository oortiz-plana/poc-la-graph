import type { Mock } from "vitest";

/** Shape of the per-file hoisted Cytoscape mock (jsdom has no canvas). */
export type CytoscapeMock = {
  on: Mock;
  destroy: Mock;
  elements: Mock;
  add: Mock;
  layout: Mock;
  pan: Mock;
  zoom: Mock;
};

export function resetCytoscapeMock(mock: CytoscapeMock) {
  mock.on.mockReset();
  mock.destroy.mockReset();
  mock.elements.mockClear();
  mock.add.mockReset();
  mock.layout.mockClear();
  mock.pan.mockClear();
  mock.zoom.mockClear();
}

export function addedElements(mock: CytoscapeMock): {
  data: Record<string, string>;
}[] {
  return mock.add.mock.calls.at(-1)?.[0] ?? [];
}
