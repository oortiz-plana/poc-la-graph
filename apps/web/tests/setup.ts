import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};
