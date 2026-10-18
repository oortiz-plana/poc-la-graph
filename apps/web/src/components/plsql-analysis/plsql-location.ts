import { OBJECT_TABS, type PlsqlTab } from "./object-header";

export type PlsqlLocation = { objectId?: string; tab: PlsqlTab };

/** Browser history entry state written by the console; tells entries apart from foreign ones. */
export type PlsqlHistoryState = {
  plsql: 1;
  index: number;
  /** Object shown by the previous entry, so "Back" stays disabled on the first object. */
  previousObjectId?: string;
};

const DEFAULT_TAB: PlsqlTab = "overview";

function isTab(value: string | null): value is PlsqlTab {
  return OBJECT_TABS.some((tab) => tab.value === value);
}

export function parsePlsqlLocation(search: string): PlsqlLocation {
  const params = new URLSearchParams(search);
  const objectId = params.get("object")?.trim() || undefined;
  const tab = params.get("tab");
  return { objectId, tab: objectId && isTab(tab) ? tab : DEFAULT_TAB };
}

/** Query string for a location; defaults are omitted so URLs stay short. */
export function buildPlsqlSearch({ objectId, tab }: PlsqlLocation): string {
  if (!objectId) return "";
  const params = new URLSearchParams({ object: objectId });
  if (tab !== DEFAULT_TAB) params.set("tab", tab);
  return `?${params}`;
}

export function readHistoryState(
  state: unknown,
): PlsqlHistoryState | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const candidate = state as Partial<PlsqlHistoryState>;
  return candidate.plsql === 1 && typeof candidate.index === "number"
    ? (candidate as PlsqlHistoryState)
    : undefined;
}
