"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  PlsqlObjectReference,
  PlsqlUsageSummary,
  PlsqlUsageWindow,
} from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { AnalysisError } from "./analysis-error";
import {
  USAGE_WINDOWS,
  barPercent,
  errorRate,
  operationLabelKey,
} from "./usage-metrics";
import { useUsageSummary } from "./use-usage-summary";

/**
 * Admin-only summary of how people use this console: request volume, who
 * used it, which views they opened and which objects they looked at most.
 */
export function UsagePanel({
  onOpenObject,
}: {
  onOpenObject: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlUsage");
  const [days, setDays] = useState<PlsqlUsageWindow>(7);
  const [attempt, setAttempt] = useState(0);
  const { summary, isLoading, errorCode } = useUsageSummary(days, attempt);
  return (
    <section aria-labelledby="plsql-usage-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="plsql-usage-heading"
            className="text-sm font-semibold text-text-secondary"
          >
            {t("heading")}
          </h2>
          <p className="text-xs text-text-secondary">{t("adminOnly")}</p>
        </div>
        <WindowPicker value={days} onChange={setDays} />
      </div>
      <UsageBody
        summary={summary}
        isLoading={isLoading}
        errorCode={errorCode}
        onRetry={() => setAttempt((current) => current + 1)}
        onOpenObject={onOpenObject}
      />
    </section>
  );
}

function UsageBody({
  summary,
  isLoading,
  errorCode,
  onRetry,
  onOpenObject,
}: {
  summary: PlsqlUsageSummary | undefined;
  isLoading: boolean;
  errorCode: string | undefined;
  onRetry: () => void;
  onOpenObject: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlUsage");
  if (errorCode === "analysis_not_configured") {
    return (
      <p
        role="status"
        className="rounded-md border border-dashed p-4 text-sm text-text-secondary"
      >
        {t("disabled")}
      </p>
    );
  }
  if (errorCode) return <AnalysisError code={errorCode} onRetry={onRetry} />;
  if (isLoading || !summary) {
    return (
      <div role="status" aria-label={t("loading")} className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (summary.requests === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-text-secondary">
        {t("empty", { days: summary.daysInWindow })}
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <UsageStats summary={summary} />
      {summary.truncated && (
        <p className="text-xs text-text-secondary">{t("truncated")}</p>
      )}
      <DailyBars daily={summary.daily} />
      <div className="grid gap-6 lg:grid-cols-2">
        <OperationsTable operations={summary.operations} />
        <UsersTable users={summary.users} />
      </div>
      <TopObjects objects={summary.topObjects} onOpenObject={onOpenObject} />
    </div>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: PlsqlUsageWindow;
  onChange: (days: PlsqlUsageWindow) => void;
}) {
  const t = useTranslations("plsqlUsage");
  return (
    <div role="group" aria-label={t("window")} className="flex gap-1">
      {USAGE_WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={days === value}
          onClick={() => onChange(days)}
          className={cn(
            "rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            days === value
              ? "border-primary bg-selected"
              : "bg-surface hover:border-text-muted",
          )}
        >
          {t("days", { days })}
        </button>
      ))}
    </div>
  );
}

function UsageStats({ summary }: { summary: PlsqlUsageSummary }) {
  const t = useTranslations("plsqlUsage.stats");
  const format = useFormatter();
  const rate = errorRate(summary.requests, summary.errors);
  const stats = [
    { key: "requests", value: format.number(summary.requests) },
    { key: "users", value: format.number(summary.distinctUsers) },
    {
      key: "errorRate",
      value:
        rate === undefined
          ? "—"
          : format.number(rate, { style: "percent", maximumFractionDigits: 1 }),
    },
    {
      key: "p95",
      value: t("milliseconds", { value: Math.round(summary.p95DurationMs) }),
    },
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map(({ key, value }) => (
        <div key={key} className="rounded-lg border bg-surface px-4 py-3">
          <dt className="text-xs text-text-secondary">{t(key)}</dt>
          <dd className="text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DailyBars({ daily }: { daily: PlsqlUsageSummary["daily"] }) {
  const t = useTranslations("plsqlUsage");
  const format = useFormatter();
  const busiest = Math.max(0, ...daily.map((day) => day.requests));
  return (
    <figure>
      <figcaption className="text-xs font-semibold text-text-secondary">
        {t("dailyHeading")}
      </figcaption>
      <ol
        className="mt-2 flex h-24 items-end gap-px"
        aria-label={t("dailyHeading")}
      >
        {daily.map(({ day, requests }) => {
          const label = t("dayBar", {
            day: format.dateTime(new Date(`${day}T00:00:00Z`), {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
            requests,
          });
          return (
            <li
              key={day}
              title={label}
              aria-label={label}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className="block w-full rounded-t-sm bg-primary"
                style={{
                  height: `${Math.max(barPercent(requests, busiest), requests ? 4 : 1)}%`,
                  opacity: requests ? 1 : 0.25,
                }}
              />
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function OperationsTable({
  operations,
}: {
  operations: PlsqlUsageSummary["operations"];
}) {
  const t = useTranslations("plsqlUsage");
  const format = useFormatter();
  return (
    <UsageTable
      caption={t("operationsHeading")}
      headers={[
        t("columns.operation"),
        t("columns.requests"),
        t("columns.errors"),
        t("columns.p95"),
      ]}
      rows={operations.map((row) => ({
        key: row.operation,
        cells: [
          <OperationLabel key="label" operation={row.operation} />,
          format.number(row.requests),
          format.number(row.errors),
          t("stats.milliseconds", { value: Math.round(row.p95DurationMs) }),
        ],
      }))}
    />
  );
}

function UsersTable({ users }: { users: PlsqlUsageSummary["users"] }) {
  const t = useTranslations("plsqlUsage");
  const format = useFormatter();
  return (
    <UsageTable
      caption={t("usersHeading")}
      headers={[
        t("columns.user"),
        t("columns.requests"),
        t("columns.lastActive"),
        t("columns.topOperation"),
      ]}
      rows={users.map((row) => ({
        key: row.username,
        cells: [
          row.username,
          format.number(row.requests),
          format.dateTime(new Date(row.lastActiveAt), {
            dateStyle: "medium",
            timeStyle: "short",
            // Fetched in the browser, so the viewer's own zone is the right one.
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          <OperationLabel key="label" operation={row.topOperation} />,
        ],
      }))}
    />
  );
}

function OperationLabel({ operation }: { operation: string }) {
  const t = useTranslations("plsqlUsage.operations");
  const key = operationLabelKey(operation);
  return <>{key ? t(key) : operation}</>;
}

function UsageTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="pb-2 text-left text-xs font-semibold text-text-secondary">
          {caption}
        </caption>
        <thead>
          <tr className="border-b text-xs text-text-secondary">
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={cn(
                  "py-1 pr-3 font-medium",
                  index > 0 && "text-right",
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={cn(
                    "py-1.5 pr-3",
                    index > 0 && "text-right tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopObjects({
  objects,
  onOpenObject,
}: {
  objects: PlsqlUsageSummary["topObjects"];
  onOpenObject: (reference: PlsqlObjectReference) => void;
}) {
  const t = useTranslations("plsqlUsage");
  if (objects.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-text-secondary">
        {t("topObjectsHeading")}
      </h3>
      <ol className="mt-2 grid gap-2 sm:grid-cols-2">
        {objects.map(({ objectId, object, requests }) => (
          <li
            key={objectId}
            className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 text-sm"
          >
            {object ? (
              <button
                type="button"
                onClick={() => onOpenObject(object)}
                className="min-w-0 truncate text-left text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {object.qualifiedName}
              </button>
            ) : (
              <span className="min-w-0 truncate text-text-secondary">
                {t("objectGone")}
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums text-text-secondary">
              {t("requestCount", { requests })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
