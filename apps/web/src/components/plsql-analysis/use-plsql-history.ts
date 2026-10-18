"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildPlsqlSearch,
  parsePlsqlLocation,
  readHistoryState,
  type PlsqlHistoryState,
  type PlsqlLocation,
} from "./plsql-location";

type Position = {
  index: number;
  maxIndex: number;
  hasPreviousObject: boolean;
};

/**
 * Keeps the selected object and tab in the browser URL (`?object=…&tab=…`) so
 * links can be shared, a reload restores the view, and the browser's Back and
 * Forward buttons walk the objects the user visited. Selecting an object
 * pushes an entry; switching tabs only replaces the current one.
 *
 * `onLocation` fires once on mount and on every Back/Forward traversal.
 */
export function usePlsqlHistory(onLocation: (location: PlsqlLocation) => void) {
  const [position, setPosition] = useState<Position>({
    index: 0,
    maxIndex: 0,
    hasPreviousObject: false,
  });
  const onLocationRef = useRef(onLocation);
  const indexRef = useRef(0);
  const maxIndexRef = useRef(0);
  const objectIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    onLocationRef.current = onLocation;
  });

  useEffect(() => {
    const initial = readHistoryState(window.history.state);
    const location = parsePlsqlLocation(window.location.search);
    indexRef.current = initial?.index ?? 0;
    maxIndexRef.current = indexRef.current;
    objectIdRef.current = location.objectId;
    if (!initial) {
      const state: PlsqlHistoryState = { plsql: 1, index: indexRef.current };
      window.history.replaceState(state, "", window.location.href);
    }
    setPosition({
      index: indexRef.current,
      maxIndex: maxIndexRef.current,
      hasPreviousObject: initial?.previousObjectId !== undefined,
    });
    onLocationRef.current(location);

    function onPopState(event: PopStateEvent) {
      const state = readHistoryState(event.state);
      const next = parsePlsqlLocation(window.location.search);
      indexRef.current = state?.index ?? 0;
      objectIdRef.current = next.objectId;
      setPosition({
        index: indexRef.current,
        maxIndex: maxIndexRef.current,
        hasPreviousObject: state?.previousObjectId !== undefined,
      });
      onLocationRef.current(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const commit = useCallback(
    (location: PlsqlLocation, mode: "push" | "replace") => {
      const url = `${window.location.pathname}${buildPlsqlSearch(location)}`;
      if (mode === "push") {
        const state: PlsqlHistoryState = {
          plsql: 1,
          index: indexRef.current + 1,
          previousObjectId: objectIdRef.current,
        };
        window.history.pushState(state, "", url);
        indexRef.current = state.index;
        maxIndexRef.current = state.index;
        setPosition({
          index: state.index,
          maxIndex: state.index,
          hasPreviousObject: state.previousObjectId !== undefined,
        });
      } else {
        const current = readHistoryState(window.history.state);
        const state: PlsqlHistoryState = {
          plsql: 1,
          index: indexRef.current,
          previousObjectId: current?.previousObjectId,
        };
        window.history.replaceState(state, "", url);
      }
      objectIdRef.current = location.objectId;
    },
    [],
  );

  return {
    commit,
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    canGoBack: position.hasPreviousObject,
    canGoForward: position.index < position.maxIndex,
  };
}
