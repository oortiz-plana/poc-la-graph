"use client";

import { createContext, useContext } from "react";

/**
 * Id of the object the Inspector is currently showing, if any. Provided by
 * the workspace so a trail (a "why is this affected?" chain, a route, a
 * dependency) can mark which of its stops the detail pane refers to, without
 * every panel having to thread the id through.
 */
const InspectedObjectContext = createContext<string | undefined>(undefined);

export const InspectedObjectProvider = InspectedObjectContext.Provider;

export function useInspectedObjectId(): string | undefined {
  return useContext(InspectedObjectContext);
}
