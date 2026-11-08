# ADR 0018: PL/SQL console usage analytics

- Status: accepted
- Date: 2026-11-07

## Context

We had no way to see how developers use the `/plsql` console. The only signal
was the generic `request_completed` log line, which has no persistence, no
aggregation and nothing visible in the product
([telemetry](../observability/telemetry.md)). Admins want to know which views
people open, how often, by whom, how often requests fail and how fast they
are, so they can judge adoption and follow up with the people using it.

## Decision

Record one usage event per authenticated `/api/v1/plsql/*` request and show an
aggregate to admins on the console landing page.

- **Capture.** A middleware registered only when `PLSQL_USAGE_ENABLED=true`
  reads the matched route name (the operation), status, duration, the
  principal that the role dependency placed on `request.state`, and the
  `objectId` query parameter when the request has one. Requests with no
  principal (failed authentication) are not recorded. Reading the usage
  summary is not recorded. A failed write never fails the user's request. It
  is logged as `plsql_usage_record_failed` with `error_type`.
- **What is stored.** Timestamp, tenant, subject, username, operation,
  outcome (`ok` / `client_error` / `server_error`), HTTP status, duration and
  object id, in the `plsql_usage_events` table of the conversation database
  (migration `20261107_0006`).
- **Identifiable usernames.** We store the readable username so admins can
  see activity per person. This is a deliberate departure from the
  identity-free policy for the log stream. The subject is stored too and is
  the key for counting distinct people, because a username can change.
- **What is never stored.** Search text, source content, tokens and request
  bodies. Subject and username are not added to the JSON log allowlist, so
  they stay out of the log stream. Only `operation` is added there.
- **Retention.** Events older than `PLSQL_USAGE_RETENTION_DAYS` (default 90,
  at most 365) are purged at startup and on the existing cleanup loop.
- **Read path.** `GET /api/v1/plsql/usage?days=7|30|90` requires the `admin`
  role and is scoped to the caller's tenant. It returns totals, distinct
  people, failed requests, p50/p95 duration, per-operation and per-person
  rows, a zero-filled per-day series and the ten most viewed objects. Each
  object is resolved through the analysis gateway when it still exists. One
  summary reads at most 100,000 events and reports `truncated` beyond that.
- **No external metrics stack.** The POC has no metrics backend. Reusing the
  conversation database keeps this self-contained. A deployment with a
  telemetry platform can replace the recorder behind the `UsageRecorder` port.

## Consequences

- Admins see per-person activity, so the table must be treated as personal
  data: admin-only reads, bounded retention, and no copies in logs.
- The feature is off by default. Turning it on is an environment change only.
- Contract artifacts: `contracts/schemas/plsql-usage.schema.json`, the
  `/api/v1/plsql/usage` path and `PlsqlUsage*` schemas in
  `contracts/openapi/openapi.yaml`, and `plsqlUsageSummarySchema` in
  `apps/web/src/lib/contracts.ts`. A backend test keeps the frozen path and
  schemas equal to the live OpenAPI.
