# Observability

The API and knowledge-ingestion CLI emit one compact JSON object per event to
standard output. Both processes use the same formatter, which makes Compose
logs directly consumable by log shippers without a second CLI-only format.

## Structured fields

Every record includes `timestamp`, `level`, `service`, `logger`, and `message`.
The formatter accepts only this reviewed context allowlist:

- request: `request_id`, `method`, `path`, `status_code`
- failures: `error_type`, `component`
- PL/SQL console: `operation` (route name only)
- ingestion: `ingestion_id`, `graph_version`, `document_count`
- graph: `node_count`, `edge_count`
- timing: `duration_ms`, `duration_seconds`

Arbitrary `extra` fields are ignored. Control characters, common credential
assignments, provider-token shapes, and host paths are redacted. Text is
bounded to 512 characters. Exception text and tracebacks are not sent to
standard output; use `error_type` and the correlation or ingestion identifier
to investigate in an access-controlled environment.

Callers must use stable event names and must never log document bodies, model
prompts, model credentials, full provider responses, or host filesystem paths.
The formatter is a final containment layer, not a substitute for that policy.

## Available telemetry

- HTTP completion records correlate requests through `X-Request-ID`.
- Ingestion records include job and active graph versions, discovered document
  counts, graph node/edge counts, duration, and sanitized failure categories.
- Graphify compatibility and availability events report categories without raw
  MCP payloads.
- FastAPI and HTTPX OpenTelemetry instrumentation is enabled when its installed
  packages load successfully.

## PL/SQL console usage analytics

When `PLSQL_USAGE_ENABLED=true`, the API stores one row per authenticated
`/api/v1/plsql/*` request in the `plsql_usage_events` table
([ADR 0018](../adr/0018-plsql-console-usage-analytics.md)). Each row holds the
timestamp, tenant, subject, username, operation (route name), outcome, HTTP
status, duration and, when the request names one, the object id.

This store differs from the log stream in one respect: it holds identifiable
usernames, so admins can see activity per person. To keep that contained:

- only the `admin` role can read it, through `GET /api/v1/plsql/usage`, and
  only for its own tenant;
- rows are purged after `PLSQL_USAGE_RETENTION_DAYS` (default 90);
- subject and username are not on the log allowlist, so they never reach
  standard output. The log stream gains only the `operation` field;
- search text, source content, tokens and request bodies are never stored.

The admin view lives on the `/plsql` landing page under "Console usage".

## Current POC limitations

No OpenTelemetry collector or exporter is configured, so instrumentation does
not persist or export traces by default. The suggested counters and histograms
are represented by structured events rather than a metrics backend. There are
no dashboards, alerts, log retention controls, distributed trace propagation
through MCP, or protected diagnostic store. Those are production-readiness
items and should be introduced with the deployment's telemetry platform rather
than embedded in this POC.
