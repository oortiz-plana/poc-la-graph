import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The switcher needs the Next app router and a server action; shells under test
// only need it to be present. locale-switcher.test.tsx unmocks it.
vi.mock("@/components/locale-switcher", () => ({
  LocaleSwitcher: () => null,
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
