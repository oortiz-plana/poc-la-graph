"use client";

import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

const CURRENT_ATTRIBUTE = "data-roving-current";

function itemsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("button"));
}

/**
 * Roving tab stop for a long list of buttons: only one item is reachable with
 * Tab (the focused one, else the current selection, else the first), and the
 * arrow keys, Home and End move between items. A 100-row result list then
 * costs one Tab stop instead of a hundred.
 */
export function useRovingFocus<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);

  // Runs after every render: rows come and go as groups expand and searches
  // return, and new buttons must not become tab stops by default.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = itemsOf(container);
    if (items.length === 0) return;
    const current =
      items.find((item) => item.hasAttribute(CURRENT_ATTRIBUTE)) ??
      items.find((item) => item.getAttribute("aria-current") === "true") ??
      items[0];
    for (const item of items) {
      item.tabIndex = item === current ? 0 : -1;
      if (item === current) item.setAttribute(CURRENT_ATTRIBUTE, "");
      else item.removeAttribute(CURRENT_ATTRIBUTE);
    }
  });

  function onFocus(event: FocusEvent<T>) {
    const container = containerRef.current;
    const target = event.target;
    if (!container || !(target instanceof HTMLElement)) return;
    if (!itemsOf(container).includes(target)) return;
    for (const item of itemsOf(container)) {
      item.tabIndex = item === target ? 0 : -1;
      if (item === target) item.setAttribute(CURRENT_ATTRIBUTE, "");
      else item.removeAttribute(CURRENT_ATTRIBUTE);
    }
  }

  function onKeyDown(event: KeyboardEvent<T>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const container = containerRef.current;
    if (!container) return;
    const items = itemsOf(container);
    const index = items.findIndex((item) => item === document.activeElement);
    if (index === -1) return;
    let next: number | undefined;
    if (event.key === "ArrowDown") next = Math.min(index + 1, items.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return { containerRef, containerProps: { onFocus, onKeyDown } };
}
