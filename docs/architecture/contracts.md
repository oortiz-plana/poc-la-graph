# Contract Freeze

The authenticated project-workspace contract is frozen as of 2026-08-04 and is
governed by [ADR 0008](../adr/0008-authenticated-multi-project-workspace.md) and
[ADR 0009](../adr/0009-private-project-conversations.md).
All `/api/v1/projects`, `/api/v1/knowledge`, and `/api/v1/conversations`
operations require bearer authentication. `/health`, `/ready`, and the Next.js
`/api/config` runtime configuration remain public.

Project creation, upload-session creation/finalization, and build submission
require `Idempotency-Key`. Upload part URLs accept raw bytes with `PUT`.
Conversation creation requires `projectId`. Conversation operations are scoped
to the authenticated subject; lists use server-defined `updatedAt` descending
ordering and opaque cursors. `DELETE` archives, restore reverses archival, and a
separate purge endpoint permanently deletes archived history. Each message pins
the then-active immutable graph and source-index version before retrieval.
Existing answer and SSE shapes remain unchanged.

ADR 0010 replaces organization-wide project visibility with tenant-scoped
memberships. Project responses expose the caller's effective role and
server-computed allowed actions. Memberships, access requests, directory search,
and access activity are authenticated project subresources. Realm roles do not
grant implicit project content access.

The initial POC contract is frozen as of 2026-07-28.

Normative artifacts:

- `contracts/openapi/openapi.yaml`: HTTP endpoints and public payloads.
- `contracts/events/sse-events.schema.json`: SSE envelope and event payloads.
- `contracts/schemas/answer.schema.json`: completed answer.
- `contracts/schemas/graph-evidence.schema.json`: normalized evidence.
- `contracts/mcp/graphify-adapter.md`: internal Graphify interface.

## Compatibility rules

- Additive optional fields are backward compatible.
- New SSE event names require consumers to ignore unknown event types.
- Removing or renaming fields, changing field meaning, or changing event ordering
  is breaking and requires a new API version or migration ADR.
- JSON property names use `camelCase`; Python and MCP adapters translate at their
  boundaries.
- Timestamps are UTC RFC 3339 strings.
- IDs are opaque non-empty strings. Clients must not infer their structure.
- SSE frames set both `event: <type>` and `data: <JSON envelope>`.
- The terminal event is exactly one of `message.completed` or `message.failed`.

## Required successful event order

`message.started`, zero or more paired `tool.started`/`tool.completed` events,
zero or more `answer.delta` and `citation.available` events, then
`message.completed`. A tool start must precede its matching completion. Citation
events may arrive before or after answer deltas. An error terminates the stream
with `message.failed`.

## PL/SQL analysis contract (2026-09-04)

Governed by [ADR 0011](../adr/0011-plsql-analysis-console-workspace.md) through
[ADR 0015](../adr/0015-plsql-console-runtime-and-test-topology.md); full shape
in [plsql-analysis-console.md](plsql-analysis-console.md). The additive,
authenticated `/api/v1/plsql` surface serves the developer console:

- `GET /objects` — deterministic bounded object search (`q`, `kinds`, `limit`).
- `GET /object?objectId=…`, `/callers?objectId=…`, `/callees?objectId=…`,
  `/table-access?objectId=…` — object detail and typed dependency lists.
- `GET /paths?from=…&to=…` — bounded dependency paths over
  `CALLS|READS|WRITES|VIEW_DEPENDS_ON` within `plsql_max_hops`, ordered by hop
  count then lexicographic node ids, duplicates collapsed.
- `GET /unresolved` — `AMBIGUOUS|UNRESOLVED` edges with evidence; uncertainty
  is surfaced as data and never presented as certainty.
- `GET /relationships/evidence?relationshipId=…` — one typed edge with its
  evidence coordinates.
- `GET /source?objectId=…` and `GET /files?fileId=…[&startLine=…][&endLine=…]`
  — read-only source text (`{file, lines, highlight}`) served strictly under
  the configured `PLSQL_SOURCE_ROOT` with traversal guards and the
  `plsql_max_source_bytes` cap.
- `GET /impact?objectId=…` — transitive dependents within `plsql_max_hops`
  grouped by distance, each item carrying its shortest explaining path(s)
  with per-hop evidence; no severity is stored or fabricated.
- Opaque identifiers embed `/` (`plsql://…`, `edge://…`, `file://…`), so
  identifier endpoints take query parameters, never path segments.
- Envelopes are `{items, truncated, count}`; results are bounded server-side
  (`plsql_max_rows`, `plsql_max_hops`) and truncated results are flagged, never
  silently clipped.
- Public vocabulary follows the implemented graph: relationships
  (`CALLS`, `READS`, `WRITES`, `VIEW_DEPENDS_ON`, `TRIGGER_ON`, …) and
  `resolution` (`EXACT`, `INFERRED`, `AMBIGUOUS`, `UNRESOLVED`).
- `/ready` reports `components.analysis.status` as
  `disabled | synthetic | connected | unavailable`.
- The analysis adapter is disabled by default
  (`PLSQL_ADAPTER=disabled`); `PLSQL_ADAPTER=synthetic` is the deterministic
  development/E2E mode and `PLSQL_ADAPTER=neo4j` uses the confirmed official
  `neo4j` 5.x driver (read-only sessions, allowlisted parameterized catalog,
  normalized errors) with real-graph schema alignment still pending a first
  live `plsqlgraph` instance.
- Source text is never raw HTML in the browser: the console renders the
  viewer's `lines` as text (ADR 0014).

Normative artifacts added for this contract:

- `contracts/schemas/plsql-object.schema.json`: object and search envelope.
- `contracts/schemas/plsql-dependency.schema.json`: typed dependency envelope.
- `contracts/schemas/plsql-path.schema.json`: ordered dependency-path envelope.
- `contracts/schemas/plsql-source.schema.json`: read-only source content.
- `contracts/schemas/plsql-impact.schema.json`: bounded impact report.
- `contracts/openapi/openapi.yaml`: `/api/v1/plsql` paths and `Plsql*`
  schemas.

Hardening (phase 6 of the
[implementation plan](../plsql-analysis/implementation-plan.md)) added no
contract surface: the five schemas, the OpenAPI splice, and the frozen
`{items, truncated, count}` envelope rules are unchanged. Configuration caps
(`plsql_max_rows`, `plsql_max_hops`, `plsql_max_source_bytes`,
`plsql_query_timeout_seconds`) are asserted at their bounds by
`apps/api/tests/plsql/test_plsql_hardening_api.py`, and the readiness matrix
(`disabled | synthetic | connected | unavailable`) is covered there too; the
deterministic console journey is exercised end to end by
`tests/e2e/specs/plsql-analysis.spec.ts` under the synthetic overlay.
