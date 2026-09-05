# ADR 0012: Deterministic read-only analysis gateway — no MCP, no raw Cypher

- Status: Accepted
- Date: 2026-09-04

## Context

The PL/SQL analysis platform stores its semantic graph in Neo4j inside the
sibling repository (`/home/oortiz/oao/plsqlgraph`). The graph is produced by
the Xtext/EMF pipeline, synchronized through `Neo4jGraphRepository`, and today
exposed to read clients only through a **stdio MCP server** or direct Bolt.
This repository's browser must never receive Neo4j credentials and must never
execute graph queries itself; it talks only to same-origin Next.js routes that
proxy an authenticated FastAPI boundary (the existing backend-for-frontend
architecture).

The product decision for this phase is explicit: the existing MCP server is
**out of scope** — the UI must not depend on it — and implementation should
start from **deterministic, bounded query paths**. The repository already has
the right idioms to copy: the Graphify integration exposes exactly four
allowlisted operations through a protocol with bounded, normalized results and
explicit `real`/`synthetic` runtime modes; every traversal is bounded by
configuration; and a generic query surface (`run_cypher`) would violate the
principle that Cypher stays internal.

## Decision

Own graph access inside `apps/api` with a **read-only analysis gateway** that
exposes domain operations only, backed by a deterministic allowlist of
reviewed query paths:

- New integration package `apps/api/app/integrations/plsql/` following the
  `integrations/graphify` layout: a `@runtime_checkable` protocol
  (`AnalysisGraphClient`) in `client.py` with domain methods
  (`check_connectivity`, `search_objects`, `get_object`, `callers_of`,
  `callees_of`, `table_access_of`, `find_paths`, `impact_of`,
  `relationship_evidence`), plus `models.py`, `errors.py`, and `__init__.py`.
- Two implementations: a **Neo4j adapter** (Bolt, official driver, read-only
  sessions — `AccessMode.READ` and a read-only database role when available)
  and a **deterministic synthetic adapter** seeded from repository fixtures.
  A `plsql_adapter` setting selects `disabled` (default), `synthetic`, or
  `neo4j`.
- A **server-owned query catalog** (`catalog.py`) containing only parameterized
  Cypher paths reviewed against the upstream catalog
  (`CypherExamples.java`, `com.ia.plsql.graph.neo4j/docs/neo4j-queries.md`).
  User or model input never becomes Cypher text; values flow through `$params`
  (qualified names and opaque ids such as `plsql://sample/HR/PACKAGE/...`).
  No `run_cypher`-style endpoint is exposed to the UI or API.
- Bounds are enforced by configuration (`PLSQL_MAX_HOPS` ≤ 5, `PLSQL_MAX_ROWS`
  ≤ 200, query timeouts, pagination) and every envelope carries a
  `truncated` flag; behavior and results are deterministic for a fixed graph
  and catalog version.
- The gateway is **read-only**: writes, imports, and synchronization remain in
  `plsqlgraph`. Analysis queries target the configured analyzed corpus
  (`PLSQL_PROJECT_ID`), which is deployment configuration, never client input.
- Routes are mounted as a new `apps/api/app/api/routes/plsql/router.py`
  (`prefix="/api/v1/plsql"`) requiring `Depends(require_viewer)`, with the
  analysis client built by a `build_analysis_client(settings)` factory in
  `apps/api/app/api/dependencies.py` and attached to `request.app.state`.
  `/ready` reports analysis connectivity as
  `disabled | synthetic | connected | unavailable` without exposing secrets.
- The official Python `neo4j` driver is proposed as a new dependency for the
  real adapter only (AGENTS.md requires explicit dependency confirmation
  before it is added; the synthetic adapter needs none). The driver is
  confined to `integrations/plsql/neo4j_client.py`.

## Consequences

- The browser contract, UI, and tests never depend on the upstream MCP server
  or on Neo4j availability; development and E2E run against the deterministic
  synthetic adapter.
- Callees-of and object search are not present in the upstream catalog; the
  gateway extends it with reviewed, parameterized paths (inverse `CALLS`,
  label-filtered lookup) and keeps them in `catalog.py` so the two repos
  can converge.
- Graph evidence vocabulary follows the implemented graph (resolution enum,
  DML collapsed to `WRITES`; no numeric confidence), which means public
  payloads (ADR 0013) differ from the older draft document — a documented,
  intentional divergence.
- A Neo4j outage yields an explicit `unavailable` state in the console, never
  a fabricated answer or an unhandled error.
- MCP, writes, and incremental re-analysis remain explicitly deferred (see
  "Future extensions" in the architecture document).

## Status update (implementation)

The dependency-confirmation gate in the decision above was approved: the
official `neo4j` Python driver (`neo4j>=5.26,<6`) is pinned in
`apps/api/pyproject.toml` and confined to `integrations/plsql/neo4j_client.py`.
The Neo4j adapter is implemented per this ADR — read-only Bolt sessions
(enforced from `plsql_neo4j_read_only`), the allowlisted parameterized
catalog (`integrations/plsql/catalog.py`), normalized errors, and the
`disabled | synthetic | connected | unavailable` readiness contract. Catalog
node-property assumptions not pinned by the architecture document are
isolated in `catalog.py` schema constants; the first real-graph validation
against a `plsqlgraph`-synchronized instance remains the alignment gate.
