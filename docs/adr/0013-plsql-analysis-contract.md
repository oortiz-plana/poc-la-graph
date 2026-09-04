# ADR 0013: PL/SQL analysis contract, evidence, and identifier rules

- Status: Accepted
- Date: 2026-09-04

## Context

The browser must consume a stable, camelCase, additive contract for analysis
queries, validated at every boundary (Pydantic, shared JSON Schema/OpenAPI,
Zod) — the repository's public-contract invariants require coordinated
updates and forbid relying on internal identifier structure. The upstream
graph (survey of `com.ia.plsql.graph.neo4j` and
`com.ia.plsql.graph.core`) stores evidence as relationship/node properties
(`resolution` in `EXACT|INFERRED|AMBIGUOUS|UNRESOLVED`, `sourceFileId`,
`startOffset`, `endOffset`, `startLine`, `startColumn`, `evidenceKind`,
`sourceRole`) and never stores raw source text in the graph. The upstream
architecture document used a finer relationship vocabulary
(`INSERTS`/`UPDATES`/`DELETES`) and a numeric confidence; the implemented
graph collapses DML to `WRITES` and expresses uncertainty only through the
resolution enum.

## Decision

Freeze an additive **analysis contract** under `/api/v1/plsql/...` with
domain-oriented operations and camelCase JSON (the list is the MVP surface,
not exhaustive — additive endpoints are allowed under the rules below):

- `GET /api/v1/plsql/objects` and `/object?objectId=...` — deterministic,
  bounded search and object detail.
- `/callers?objectId=...`, `/callees?objectId=...`,
  `/table-access?objectId=...` — directional dependency lists.
- `/impact?objectId=...` and `/paths?from=...&to=...` — bounded transitive
  impact (≤ 5 hops) and bounded dependency paths.
- `/unresolved` — `AMBIGUOUS`/`UNRESOLVED` edges with their evidence.
- `/relationships/evidence?relationshipId=...` — evidence coordinates for one
  relationship.
- `/source?objectId=...` and `/files?fileId=...` — read-only source content,
  object-scoped or by file, with an optional line/offset range for
  highlighting.

Public models follow the implemented graph rather than the older draft
vocabulary: relationships use `CALLS`, `READS`, `WRITES`,
`VIEW_DEPENDS_ON`, `TRIGGER_ON`, `INDEXES`, `SYNONYM_FOR`, `DECLARES`,
`CONTAINS`; uncertainty uses the `resolution` enum with
`EXACT|INFERRED|AMBIGUOUS|UNRESOLVED`; no numeric confidence is invented
where the graph stores none. Edges render as `source → relationship →
target`. Every dependency and impact item carries its evidence coordinate
(`sourceFileId`/relative path, `startLine`, `startColumn`, `startOffset`,
`endOffset`) when the graph has one.

Result payloads are bounded envelopes (`items`, `truncated`, optional
`count`), mirroring the `{rows, count, truncated}` precedent of the upstream
read layer, and pagination is server-defined.

Identifiers are opaque to clients. The browser stores and echoes the
`plsql://`, `file://`, `project://`, and `edge://` strings it receives but
never parses them; the gateway translates user-facing parameters (qualified
names like `HR.PKG_EMPLOYEE.CREATE_EMPLOYEE`) server-side. Because those
identifiers embed `/` characters, identifier-carrying endpoints receive them
as query parameters (`objectId`, `relationshipId`, `fileId`) rather than path
segments, so they survive proxies and routers without double encoding.

Evidence representation: relationship/node properties for the MVP — no
separate evidence nodes — matching upstream ADR-006's initial choice and the
current persistence model.

## Consequences

- One normative set of artifacts is updated together: backend Pydantic models,
  `contracts/` JSON Schema and OpenAPI additions, `apps/web/src/lib/contracts.ts`
  Zod schemas/types, and tests. Additions are additive-only for the MVP;
  breaking changes need a new ADR and versioning decision.
- The public vocabulary intentionally diverges from the source document where
  the implemented graph differs; the difference is documented in the
  architecture document and in the query catalog so both repositories stay in
  agreement.
- Bounds are enforced server-side (hops, rows, truncation, timeouts) and
  surfaced through `truncated` flags; the UI must show truncation and
  resolution explicitly.
- Source content is never part of graph or evidence payloads except through
  the dedicated source endpoint, which serves read-only text scoped to the
  configured source root (ADR 0012).
