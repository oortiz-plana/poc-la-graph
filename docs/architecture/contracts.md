# Contract Freeze

The authenticated project-workspace contract is frozen as of 2026-08-03 and is
governed by [ADR 0008](../adr/0008-authenticated-multi-project-workspace.md).
All `/api/v1/projects`, `/api/v1/knowledge`, and `/api/v1/conversations`
operations require bearer authentication. `/health`, `/ready`, and the Next.js
`/api/config` runtime configuration remain public.

Project creation, upload-session creation/finalization, and build submission
require `Idempotency-Key`. Upload part URLs accept raw bytes with `PUT`.
Conversation creation requires `projectId`. Each message pins the then-active
immutable graph and source-index version before retrieval. Existing answer and
SSE shapes remain unchanged.

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
