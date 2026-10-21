"use client";

import {
  Boxes,
  Database,
  FileCode2,
  LayoutDashboard,
  Network,
  Package,
  Route,
  Table2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { searchPlsqlObjects } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AnalysisPaginationScope } from "./analysis-pagination";
import { primaryFilter, type ObjectFilterKey } from "./object-filters";

type StatKey = Extract<
  ObjectFilterKey,
  "all" | "packages" | "routines" | "tables" | "views"
>;

const STATS: { key: StatKey; icon: LucideIcon }[] = [
  { key: "all", icon: Database },
  { key: "packages", icon: Package },
  { key: "routines", icon: Boxes },
  { key: "tables", icon: Table2 },
  { key: "views", icon: LayoutDashboard },
];

type GuideKey = "overview" | "dependencies" | "impact" | "paths" | "source";

const GUIDE: { key: GuideKey; icon: LucideIcon }[] = [
  { key: "overview", icon: LayoutDashboard },
  { key: "dependencies", icon: Network },
  { key: "impact", icon: Zap },
  { key: "paths", icon: Route },
  { key: "source", icon: FileCode2 },
];

/** Object counts per kind, read as the `count` of a one-row search. */
async function loadCounts(): Promise<Record<StatKey, number>> {
  const counts = await Promise.all(
    STATS.map(({ key }) =>
      searchPlsqlObjects("", { kinds: primaryFilter(key).kinds, limit: 1 }),
    ),
  );
  return Object.fromEntries(
    STATS.map(({ key }, index) => [key, counts[index].count]),
  ) as Record<StatKey, number>;
}

/**
 * What the workspace shows before an object is chosen: how big the analyzed
 * project is (each number opens the Explorer on that kind) and what each view
 * of an object offers, so the empty space is a map of the tool instead of a
 * dead end.
 */
export function WorkspaceLanding(props: {
  onBrowseKind: (key: ObjectFilterKey) => void;
}) {
  return (
    <AnalysisPaginationScope>
      <WorkspaceLandingContent {...props} />
    </AnalysisPaginationScope>
  );
}

function WorkspaceLandingContent({
  onBrowseKind,
}: {
  onBrowseKind: (key: ObjectFilterKey) => void;
}) {
  const t = useTranslations("plsqlWorkspace");
  const format = useFormatter();
  const { data: counts, error } = useSWR("plsql-landing-counts", loadCounts);
  return (
    <div className="mt-6 space-y-8">
      {!error && (
        <section aria-labelledby="plsql-landing-stats">
          <h2
            id="plsql-landing-stats"
            className="text-sm font-semibold text-text-secondary"
          >
            {t("workspace.landing.statsHeading")}
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {STATS.map(({ key, icon: Icon }) => {
              const label =
                key === "all"
                  ? t("workspace.landing.total")
                  : t(`filters.${key}`);
              return (
                <li key={key}>
                  <button
                    type="button"
                    title={t("workspace.landing.openFilter", { label })}
                    onClick={() => onBrowseKind(key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition-colors",
                      "hover:border-primary hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    )}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-selected text-primary">
                      <Icon aria-hidden className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      {counts ? (
                        <span className="block text-xl font-semibold tabular-nums">
                          {format.number(counts[key], {
                            useGrouping: "always",
                          })}
                        </span>
                      ) : (
                        <Skeleton className="h-7 w-14" />
                      )}
                      <span className="block truncate text-xs text-text-secondary">
                        {label}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="plsql-landing-guide">
        <h2
          id="plsql-landing-guide"
          className="text-sm font-semibold text-text-secondary"
        >
          {t("workspace.landing.guideHeading")}
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDE.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="flex gap-3 rounded-lg border bg-surface p-4"
            >
              <Icon
                aria-hidden
                className="mt-0.5 h-5 w-5 shrink-0 text-primary"
              />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  {t(`header.tabs.${key}`)}
                </h3>
                <p className="mt-1 text-sm text-text-secondary">
                  {t(`workspace.landing.guide.${key}`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-text-secondary">
        {t("workspace.landing.start")}
      </p>
    </div>
  );
}
