# ADR 0015: PL/SQL console runtime and test topology

- Status: Accepted
- Date: 2026-09-04

## Context

The default Compose stack in this repository runs the legal-chat product
(Keycloak, Graphify runtime, `api`, `web`, knowledge workers) and must keep
working unchanged. The PL/SQL analysis console needs a graph only when a
developer connects one; the analysis graph is owned and synchronized by the
sibling `plsqlgraph` repository (its Compose exposes Bolt on host port 7687,
`neo4j:2026.07.1-community`, credentials `neo4j/neo4j` — no read-only role is
created there, so read-only enforcement must be client-side). E2E suites in
this repository run against the explicit synthetic overlay
(`docker-compose.synthetic.yml`) and must not require the real runtime.
Deterministic development is the phase-1 mode (ADR 0012), so the console and
gateway must be fully testable without any external service.

## Decision

- **Default compose is unchanged.** `PLSQL_ADAPTER` defaults to `disabled`; the
  console renders an explicit "Analysis is not configured" state and the API
  reports `disabled` in `/ready`. No new long-running service is added to
  `docker-compose.yml`.
- **Real mode is opt-in via environment**, not a new default service: point
  `PLSQL_ADAPTER=neo4j`, `PLSQL_NEO4J_URI`, `PLSQL_NEO4J_USER`,
  `PLSQL_NEO4J_PASSWORD`, `PLSQL_NEO4J_READ_ONLY=true`, `PLSQL_PROJECT_ID`,
  and the source root at an already-synchronized graph (for example the
  `neo4j` container from `plsqlgraph`). Credentials live only in server-side
  environment/Compose secrets — never in `.env.example` with a real value,
  never in the browser. If a bundled dev graph is wanted later, it goes in an
  optional `compose/plsql-neo4j.yml` overlay, not the default model.
- **Deterministic mode is the default development surface**: the synthetic
  adapter is fixture-driven (minimal synthetic PL/SQL + graph fixtures kept in
  the repo; no proprietary sources). Setting `PLSQL_ADAPTER=synthetic` is
  sufficient; the E2E overlay
  (`docker-compose.synthetic.yml` extension) sets it for the `api` service so
  `make e2e` exercises the PL/SQL console deterministically.
- **Source content serving**: the source endpoint reads files beneath a
  configured server-side source root only (`PLSQL_SOURCE_ROOT`, mounted
  read-only when containerized), resolving project-relative paths with strict
  traversal guards. Raw source text never enters graph, evidence, or browser
  bundles beyond the dedicated source response.
- **Test topology**: unit/API tests inject fakes (protocol-level doubles in
  `apps/api/tests/plsql/`); web component tests mock `@/lib/api`; new
  Playwright specs live in `tests/e2e/specs/plsql-analysis.spec.ts` and run
  only under the synthetic overlay. Readiness and health behavior for the
  analysis subsystem is asserted in API tests and the smoke script.

## Consequences

- The legal-chat runtime, health checks, and smoke flows are untouched; the
  console is additive and separately configured.
- Deterministic E2E remains the gate for merging UI work, matching the
  repository rule that synthetic tests verify deterministic application
  behavior, not the real analysis runtime.
- Real-graph verification requires an explicit developer step
  (`plsqlgraph` synchronization + `PLSQL_ADAPTER=neo4j`), which keeps
  proprietary corpora out of this repository.
- Secret handling, traversal guards, and read-only enforcement are concrete
  acceptance criteria for the gateway and source endpoints (see the
  implementation plan).
