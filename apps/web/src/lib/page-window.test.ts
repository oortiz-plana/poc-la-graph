import { describe, expect, it } from "vitest";
import { pageWindow } from "./page-window";

describe("pageWindow", () => {
  it("is empty without pages and a single slot for one page", () => {
    expect(pageWindow(0, 0)).toEqual([]);
    expect(pageWindow(0, 1)).toEqual([0]);
  });

  it("lists the pages around the current one", () => {
    expect(pageWindow(0, 5)).toEqual([0, 1, "gap-end", 4]);
    expect(pageWindow(2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageWindow(1, 3)).toEqual([0, 1, 2]);
  });

  it("collapses distant pages into ellipses around the current one", () => {
    expect(pageWindow(10, 30)).toEqual([
      0,
      "gap-start",
      9,
      10,
      11,
      "gap-end",
      29,
    ]);
  });

  it("shows a lone hidden page instead of an ellipsis", () => {
    expect(pageWindow(3, 9)).toEqual([0, 1, 2, 3, 4, "gap-end", 8]);
    expect(pageWindow(5, 9)).toEqual([0, "gap-start", 4, 5, 6, 7, 8]);
  });

  it("keeps the current page at either end", () => {
    expect(pageWindow(0, 30)).toEqual([0, 1, "gap-end", 29]);
    expect(pageWindow(29, 30)).toEqual([0, "gap-start", 28, 29]);
  });
});
