# PL/SQL Analysis Console — Implementation Plan

Status: aligned with this repository on 2026-09-04. This plan implements the
UI-side product defined in
[`docs/architecture/plsql-analysis-console.md`](../architecture/plsql-analysis-console.md),
which updates the source proposal
[`arch/PL-SQL Dependency and Impact Analysis Architecture (1).md`](../../arch/PL-SQL%20Dependency%20and%20Impact%20Analysis%20Architecture%20(1).md)
for this repository. Decisions: ADR
[0011](../adr/0011-plsql-analysis-console-workspace.md) to
[0015](../adr/0015-plsql-console-runtime-and-test-topology.md).

Scope recap: this repository delivers the authenticated `/plsql` developer
console in `apps/web` plus a deterministic read-only analysis gateway in
`apps/api` (`/api/v1/plsql`). The analysis engine and Neo4j synchronization
stay in the sibling `plsqlgraph` repo. **MCP is out of scope** and **deterministic
paths come first**: development, tests, and E2E run against a fixture-driven
synthetic adapter; a real Neo4j adapter is opt-in configuration.

## Implementation status (2026-09-04)

Legend: ✅ implemented and verified · ◐ partial (foundation slices shipped) · ○ pending.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Foundation and contract | ✅ (except Neo4j adapter) | Readiness reporting, contract schemas, OpenAPI, contracts.md addendum, compose overlay shipped; `neo4j` adapter remains behind the dependency gate |
| 1 — Object search and detail | ✅ | Backend endpoints + deterministic synthetic search; web `/plsql` console; tests on both sides |
| 2 — Callers, callees, table access | ✅ | Typed-edge routes and textual views with resolution/evidence; tests on both sides |
| 3 — Paths and unresolved | ✅ | Backend `find_paths`/`/paths` + `unresolved_references`/`/unresolved`; web pickers + ordered path lists + unresolved warnings; see shipped notes below |
| 4 — Source evidence and viewer | ○ | Next: read-only source endpoint + viewer |
| 5 — Impact analysis | ○ | Next: bounded impact with explaining paths |
| 6 — Hardening | ○ | Bounds sweep, a11y, full E2E, docs/Compose sync, deferred spikes |

### Shipped — backend (`apps/api`)

- `app/config/settings.py` — `PLSQL_*` block: `plsql_adapter`
  (`disabled` | `synthetic` | `neo4j`, default `disabled`), `plsql_project_id`,
  `plsql_source_root`, Neo4j credential placeholders (server-side only),
  `plsql_max_rows` (≤ 200), `plsql_max_hops` (≤ 5), query timeout, source byte
  cap; empty secret-style values normalize to `None`.
- `app/integrations/plsql/` — `client.py` (`AnalysisGraphClient` protocol incl.
  `callers_of`/`callees_of`/`table_access_of`), `models.py` (internal object +
  dependency records), `fixtures.py` (deterministic synthetic corpus, ~15 HR
  objects incl. package members, and 14 typed edges — `CALLS`/`READS`/
  `WRITES`/`TRIGGER_ON`/`VIEW_DEPENDS_ON` with EXACT/INFERRED/UNRESOLVED
  samples), `synthetic.py` (deterministic client: search, lookups, and
  dependency pages with package-member expansion), `errors.py`, `__init__.py`.
- `app/models/plsql.py` — plus `PlsqlObjectReference`, `PlsqlDependency`,
  `PlsqlDependencyResult`, `PlsqlRelationship`, `PlsqlResolution` (+ exports,
  + `Problem` codes `analysis_not_configured`, `analysis_not_found`,
  `analysis_unavailable`, `analysis_limit_exceeded`).
- `app/api/routes/plsql/router.py`, mounted in `main.py` with exception
  handlers:
  - `GET /api/v1/plsql/objects?q=&kinds=&limit=` — deterministic search,
    bounded by `plsql_max_rows`.
  - `GET /api/v1/plsql/object?objectId=…`, `/callers?objectId=…`,
    `/callees?objectId=…`, `/table-access?objectId=…` — object detail and
    typed dependency lists. Opaque ids embed `/` (`plsql://…`), so identifier
    endpoints take query parameters instead of path segments (ADR 0013).
  - Disabled adapter → `503 analysis_not_configured`; unknown object →
    `404 analysis_not_found`; synthetic/neo4j selection via
    `build_analysis_client` in `app/api/dependencies.py`.
  - `/ready` reports `components.analysis.status`
    (`disabled | synthetic | connected | unavailable`).
- Tests: `apps/api/tests/plsql/` — `test_plsql_objects_api.py` (7) +
  `test_plsql_dependencies_api.py` (9, incl. readiness status).

Phase 3 additions:

- `app/integrations/plsql/` — `find_paths(from_id, to_id, max_hops, limit)`
  (typed `CALLS|READS|WRITES|VIEW_DEPENDS_ON` traversal, hop cap, ordering by
  hop count then lexicographic node ids, duplicate collapsing, row-cap
  `truncated` flag; unresolved placeholder edges are reported, never
  traversed) and `unresolved_references(limit)` (`AMBIGUOUS|UNRESOLVED`).
  `fixtures.py` gained one AMBIGUOUS sample
  (`HR.ARCHIVE_EMPLOYEE → HR.EMPLOYEE_DETAILS READS`) alongside the existing
  UNRESOLVED one; all prior count assertions are unchanged.
- `app/models/plsql.py` — public `PlsqlPath` (`id`, ordered `nodes`, ordered
  `relationships` with per-hop `resolution`/evidence, `hopCount`) and
  `PlsqlPathResult` envelope.
- `app/api/routes/plsql/router.py` — `GET /paths?from=…&to=…` and
  `GET /unresolved`; unknown ids → `404 analysis_not_found`, disabled →
  `503 analysis_not_configured` (existing handlers).
- Tests: `apps/api/tests/plsql/test_plsql_paths_api.py` (6) — path ordering
  and determinism (repeat calls identical), hop-cap vs truncation, row
  truncation, 404/503, unresolved listing with both resolution states and its
  truncation/503 behavior.

### Shipped — web (`apps/web`)

- `src/app/plsql/page.tsx` — `/plsql` route (AuthProvider + workspace).
- `src/components/plsql-analysis/plsql-analysis-workspace.tsx` (+ test, 10
  cases) — "Analysis is not configured" when disabled; labeled search, results
  list with kind badges, "Searching…", error `role="alert"` + "Retry analysis
  query", "No objects match", "Results truncated", object detail with
  owner/signature/return type/source `path:line` when present; and Phase 2
  dependency sections **Callers / Callees / Table access** rendered as
  `source → relationship → target` rows with resolution badges, evidence
  locations, group headings per relationship for table access, per-section
  loading/error/retry/empty states, and truncation notices.
- `src/lib/contracts.ts` — Zod schemas/types (`PlsqlObject`, kinds, source
  coordinate, search envelope, and Phase 2 `PlsqlDependency`/reference/
  relationship/resolution schemas); `plsqlEnabled` added to the runtime-config
  schema with a backward-compatible default.
- `src/lib/api.ts` — `searchPlsqlObjects`, `getPlsqlObject(objectId)`
  (404 → `null`), `listPlsqlCallers`, `listPlsqlCallees`,
  `getPlsqlTableAccess`.
- `src/app/api/config/route.ts` — `plsqlEnabled` from server env
  `PLSQL_ENABLED === "true"` (never `NEXT_PUBLIC_`).
- `src/components/application-shell.tsx` — nav entry "PL/SQL analysis" shown
  only when `plsqlEnabled` (DOM unchanged when disabled).
- `src/lib/api.test.ts` — runtime-config fixture updated for `plsqlEnabled`.

Phase 3 additions:

- `src/lib/contracts.ts` — `plsqlPathSchema`/`PlsqlPath` and
  `plsqlPathResultSchema`/`PlsqlPathResult` (ordered `nodes` +
  `relationships`, `hopCount`), additive to the existing PL/SQL block.
- `src/lib/api.ts` — `findPlsqlPaths(from, to)` over
  `/api/v1/plsql/paths?from=…&to=…` and `listPlsqlUnresolved()` over
  `/api/v1/plsql/unresolved`, both Zod-validated.
- `src/components/plsql-analysis/plsql-analysis-workspace.tsx` — sections
  **Dependency paths** (From/To pickers seeded by the search results, "Find
  paths", ordered `<ol>` path rows `A → CALLS → B → READS → T` with hop count
  and per-object link-out into the detail) and **Unresolved references**
  (warning treatment, resolution badges, evidence locations — never presented
  as certain), each with loading/error/retry/empty/truncated states following
  the Phase 2 sections.
- `plsql-analysis-workspace.test.tsx` grows from 10 to 17 cases (path
  seeding/ordering/hop counts, truncation and empty states, disabled button
  for identical endpoints, per-section retry, unresolved warning rows and
  empty/retry states; the not-configured case now also asserts the Phase 3
  sections stay out of the DOM).

### Run it (local demo)

```bash
# api service environment
PLSQL_ADAPTER=synthetic
PLSQL_PROJECT_ID=sample
# web service environment
PLSQL_ENABLED=true
```

Default remains `disabled` (no behavior change to the chat product). The
`docker-compose.synthetic.yml` overlay now enables the console deterministically
(api: `PLSQL_ADAPTER: synthetic`, `PLSQL_PROJECT_ID: sample`; web:
`PLSQL_ENABLED: true`) and both compose models validate
(`docker compose ... config`).

### Verification (2026-09-04)

- Backend: `ruff check app tests` clean; `pytest apps/api/tests/plsql` → 16/16
  (search/detail, typed dependencies, readiness); regression subset
  `test_projects_api.py` + `test_graphify_adapter.py` passed. Caveat:
  `test_api.py` (conversation/SSE/knowledge readiness) could not fully run in
  this sandbox — those cases write to `/knowledge` and to the root-owned
  tracked `apps/api/conversations.db`, both denied here; unrelated to this
  diff, so use containerized `make test-api` as the authoritative gate.
- Web: `prettier --check` clean; `npm run typecheck` clean; full vitest
  61/61 (10 PL/SQL console tests included).
- Contracts: `contracts/schemas/plsql-object.schema.json` and
  `plsql-dependency.schema.json` parse; `contracts/openapi/openapi.yaml`
  updated with the 5 PL/SQL paths and 6 `Plsql*` schemas (surgical splice,
  no pre-existing lines removed) and parses.
- `mypy app` is not a reliable signal in this sandbox (installed pydantic
  2.13/mypy 1.20 flag alias-keyword construction in pre-existing code as
  well); treat containerized `make lint` as authoritative.

### Verification — Phase 3

- Backend: `ruff check app tests` clean; `ruff format --check` clean on the
  changed package and tests; `pytest apps/api/tests/plsql` → 22/22 (Phase 1 +
  Phase 2 + `test_plsql_paths_api.py`); regression subset
  `test_projects_api.py` + `test_graphify_adapter.py` → 45 passed total.
  `mypy app` crashes with an internal mypy error in this sandbox (pre-existing
  signal documented above), so containerized `make lint` stays authoritative.
- Web: `npx prettier --write` applied to the changed files then clean;
  `npm run typecheck` clean; full `npx vitest run` → 68/68 (17 PL/SQL console
  cases, up from 10).
- Contracts: `contracts/schemas/plsql-path.schema.json` added; all three
  `plsql-*.schema.json` documents validate (draft 2020-12, cross-file `$ref`
  resolution, sample path envelope validates);
  `contracts/openapi/openapi.yaml` extended with `/paths`, `/unresolved`,
  `PlsqlPath`, and `PlsqlPathResult` and is semantically identical to the
  OpenAPI generated by the running app (verified by recursive comparison).
- E2E note: the Phase 3 Playwright spec (`tests/e2e/specs/plsql-analysis.spec.ts`)
  from the plan is not part of this diff — E2E needs the synthetic compose
  stack and was not runnable/requested in this sandbox; it remains the next
  incremental step before the phase-6 sweep.

### Remaining items

- Neo4j adapter (`neo4j_client.py`) behind the dependency-confirmation gate
  (0.1); `plsql_adapter=neo4j` currently fails fast by design.
- Phases 4–6 below (source viewer, impact, hardening) and the Phase 3 E2E
  spec noted above.

## Constraints carried into every phase

- Browser talks only to same-origin routes; every payload is Zod-validated
  (`apps/web/src/lib/contracts.ts`) before rendering.
- Backend public models are camelCase (`ApiModel` with aliases), bounded, and
  additive; contracts, OpenAPI, and Zod are updated together (ADR 0013).
- Only allowlisted, parameterized query paths execute; no raw Cypher, no MCP
  (ADR 0012). Bounds come from settings with `ge/le` validators.
- Textual evidence is mandatory; no new UI dependency in the MVP (ADR 0014).
- Default Compose stays unchanged; synthetic mode is the E2E surface
  (ADR 0015).
- Follow the focused checks of the repository before broader suites
  (AGENTS.md): `ruff format/check` + `mypy app` + focused `pytest` on the
  backend; `typecheck` + focused vitest + `prettier --check` on the web side.

## Phase overview

| Phase | Outcome | ADRs |
| --- | --- | --- |
| 0 — Foundation and contract | Gateway skeleton, synthetic adapter, contract, routes, readiness | 0012, 0013, 0015 |
| 1 — Object search and detail | Deterministic search UX | 0011, 0013, 0014 |
| 2 — Callers, callees, table access | Directional textual views | 0013, 0014 |
| 3 — Paths and unresolved | Bounded deterministic dependency paths | 0012, 0013 |
| 4 — Source evidence and viewer | Read-only source navigation | 0013, 0014, 0015 |
| 5 — Impact analysis | Explainable bounded impact report | 0013, 0014 |
| 6 — Hardening | Bounds, a11y, full E2E, docs sync | all |

Each phase is complete only when its backend tests, web component tests, and
(where noted) E2E spec pass in the synthetic mode, and the docs referenced by
that phase are updated.

---

## Phase 0 — Foundation and contract

### 0.1 Dependency decision (confirmation gate)

The real Neo4j adapter requires the official **`neo4j` Python driver** (5.x,
matching the server generation `neo4j:2026.07.1-community` that `plsqlgraph`
runs). No existing dependency covers Bolt, and the driver is confined to the
new adapter. Per AGENTS.md this is a proposal to confirm with the user before
adding to `apps/api/requirements*.txt`. Nothing else in this plan needs a new
dependency; the synthetic mode and all tests run without it.

### 0.2 Configuration

Add to `apps/api/app/config/settings.py` a grouped `PLSQL_*` block with
`ge/le` bounds, following the `GRAPHIFY_*` style:

| Setting (env) | Default | Notes |
| --- | --- | --- |
| `plsql_adapter` (`PLSQL_ADAPTER`) | `disabled` | one of `disabled`, `synthetic`, `neo4j` |
| `plsql_project_id` (`PLSQL_PROJECT_ID`) | — | Graph project filter; server config only |
| `plsql_neo4j_uri` (`PLSQL_NEO4J_URI`) | — | Bolt URI; required when `neo4j` |
| `plsql_neo4j_user` / `plsql_neo4j_password` | — | Server-side secrets; never in browser |
| `plsql_neo4j_read_only` | `true` | Enforced session mode |
| `plsql_source_root` (`PLSQL_SOURCE_ROOT`) | — | Read-only source root for the source endpoint |
| `plsql_max_hops` | `5` | ≤ 5 |
| `plsql_max_rows` | `200` | ≤ 200 |
| `plsql_query_timeout_seconds` | `10.0` | > 0 |
| `plsql_max_source_bytes` | `262144` | Per-file source cap |

### 0.3 Gateway integration package

Create `apps/api/app/integrations/plsql/` mirroring
`integrations/graphify` layout:

- `models.py` — internal Pydantic models (aliased, `extra="forbid"`) for
  objects, typed dependencies, paths, impact rows, evidence coordinates,
  envelopes.
- `errors.py` — `PlsqlError` with categories
  `unavailable | timeout | limit_exceeded | invalid_response | configuration |
  not_found`, preserving causes for server logs only.
- `client.py` — `@runtime_checkable class AnalysisGraphClient(Protocol)`:
  `check_connectivity`, `search_objects`, `get_object`, `callers_of`,
  `callees_of`, `table_access_by`, `find_paths`, `impact_of`,
  `relationship_evidence`, `object_source`.
- `catalog.py` — the allowlisted, parameterized query catalog. Phase 0 ships:
  callers (`CALLS` into target), callees (reviewed inverse `CALLS`), table
  access by package/object (`READS|WRITES`), reverse impact
  (`READS|WRITES|VIEW_DEPENDS_ON|CALLS` ≤ `plsql_max_hops`), unresolved edges,
  plus id/qualified-name helpers. Every entry is parameterized
  (`$qualifiedName`/`$objectId`/`$projectId`); no string interpolation of user
  input.
- `synthetic_client.py` — deterministic adapter over an in-repo fixture
  corpus (minimal synthetic PL/SQL objects with tables, packages, routines,
  `CALLS`/`READS`/`WRITES` edges, EXACT and UNRESOLVED samples, evidence
  coordinates, and source text files under a fixture source root). Fixtures
  live in `apps/api/tests/fixtures/plsql/` and must never contain proprietary
  code.
- `neo4j_client.py` — Bolt adapter (phase 0 can stub behind the dependency
  gate): read-only session mode, catalog execution, bounds, truncation
  envelope, driver error normalization.
- `__init__.py` re-exports, as in the other integrations.

### 0.4 Public models and routes

- `apps/api/app/models/plsql.py` — public camelCase models reusing the
  `ApiModel` alias pattern (e.g. `qualifiedName`, `sourceFileId`,
  `startLine`, `relationship`, `resolution`, `truncated`).
- `apps/api/app/api/routes/plsql/router.py` — `APIRouter(prefix="/api/v1/plsql")`
  with `Depends(require_viewer)`, domain endpoints from ADR 0013, `{requestId,
  code, message}` problems.
- Additive `Problem` codes in `apps/api/app/models/system.py`; register domain
  error handlers in `apps/api/app/main.py`. Mount the router always; when
  `plsql_adapter == "disabled"` the routes respond with a 503-style
  `analysis_not_configured` problem so the web layer can distinguish
  configuration gaps from query failures.
- `build_analysis_client(settings)` factory in
  `apps/api/app/api/dependencies.py`; client on `request.app.state`; `/ready`
  reports `analysis` status `disabled | synthetic | connected | unavailable`.

### 0.5 Contract artifacts

- `contracts/schemas/plsql-analysis.schema.json` — JSON Schema (draft
  2020-12, camelCase, `additionalProperties: false`) for the phase-0 models.
- Update `contracts/openapi/openapi.yaml` with the new routes/models.
- Extend `docs/architecture/contracts.md` with a PL/SQL contract section
  (frozen 2026-09-04, additive rules, artifact list).
- Note the intentional vocabulary divergences from the source document in the
  architecture doc (already recorded in §5 of
  `docs/architecture/plsql-analysis-console.md`).

### 0.6 Web foundation

- `apps/web/src/lib/contracts.ts` — Zod schemas/types (`plsqlObjectSchema`,
  `plsqlDependencySchema`, `plsqlPathSchema`, `plsqlImpactSchema`,
  `plsqlSourceSchema`, envelope types) derived with `z.infer`.
- `apps/web/src/lib/api.ts` — typed client functions for the endpoints in 0.4
  using `safeFetch("/api/backend/api/v1/plsql/...")` with `cache: "no-store"`.
- `apps/web/src/app/api/config/route.ts` — expose non-secret `plsqlEnabled`
  from a server env var so navigation can hide the console when the feature is
  off; update `runtimeConfigSchema`.
- `apps/web/src/components/plsql-analysis/plsql-analysis-workspace.tsx` —
  minimal workspace rendering the configured/unavailable state plus an empty
  state; unit test asserting the "Analysis is not configured" alert and the
  unavailable retry state.

### 0.7 Tests

- `apps/api/tests/plsql/` — catalog unit tests, synthetic adapter
  determinism, router tests over `httpx.ASGITransport` with
  `PLSQL_ADAPTER=synthetic`, bounds/truncation, error normalization, source
  traversal-guard tests, `/ready` states.
- Web component test for 0.6 with mocked `@/lib/api`.
- `docker-compose.synthetic.yml` — extend the `api` service with
  `PLSQL_ADAPTER: synthetic` (and fixture paths) so `make e2e` covers the
  console from phase 1 onward.

**Acceptance:** focused `pytest apps/api/tests/plsql`, `ruff check`,
`mypy app`, `npm run typecheck`, vitest for the new component all pass; the
OpenAPI and JSON Schema validate against the new models.

---

## Phase 1 — Object search and object detail

Backend:

- Catalog/search: label-filtered lookup over `DatabaseObject` kinds by
  `name`/`qualifiedName` with deterministic ordering and `plsql_max_rows`
  cap; `search_objects(q, kinds?, limit?)` (GET `/objects`) and `get_object`
  (GET `/object?objectId=…`, because opaque ids embed `/`) routes.

Web (`apps/web/src/app/plsql/page.tsx` + workspace):

- `plsql/page.tsx` = `<AuthProvider><PlsqlAnalysisWorkspace /></AuthProvider>`,
  matching the `/governance` page pattern.
- Add the console entry to `ApplicationNavigation` in
  `application-shell.tsx` (lucide icon, `min-h-11`, shown when `plsqlEnabled`).
- Workspace layout: one visible heading ("PL/SQL analysis"), search form with
  accessible label ("Search PL/SQL objects"), results list region
  ("Search results") with type badges (Package/Routine/Table/View/Trigger/…),
  schema-qualified names, and links into object detail.
- Object detail view shows the summary (kind, schema, qualified name,
  signature/return type when present, source file + declaration line) with
  textual-first section navigation (ADR 0014).

Component tests assert search submit, empty result ("No objects match"),
opening an object, and the keyboard/small-screen behavior of the workspace.

**Acceptance:** deterministic search over the synthetic corpus; typing in the
results and opening details works keyboard-only; 320px/200% zoom does not
clip controls.

---

## Phase 2 — Callers, callees, and table access

Backend: `/callers?objectId=…`, `/callees?objectId=…`,
`/table-access?objectId=…`, returning typed edges with resolution and
evidence coordinates, grouped for table access (readers/writers/triggers/
views as the graph exposes them).

Web components (`dependency-list.tsx`, reused for all three):

- Callers/Callees: rows `caller → CALLS → target` (or inverted for callees)
  with resolution badges (`EXACT`/`INFERRED`/`AMBIGUOUS`/`UNRESOLVED`) and
  `file:line` evidence links.
- Table access: grouped lists labeled by relationship
  (`READS`/`WRITES`/`TRIGGER_ON`/`VIEW_DEPENDS_ON`) with the owning routine.
- Truncation notice when the server flags `truncated`.

Accessible names for tests: headings "Callers", "Callees", "Table access";
rows expose the typed-edge text.

**Acceptance:** directional correctness asserted against synthetic fixtures
both in API tests and component tests; provenance and truncation always
visible.

---

## Phase 3 — Dependency paths and unresolved references (deterministic paths)

Backend:

- `find_paths(from, to)` over bounded typed relationships
  (`CALLS|READS|WRITES|VIEW_DEPENDS_ON`) with hop cap `plsql_max_hops`,
  deterministic ordering (hop count, then lexicographic node ids), duplicate
  collapsing, and a `truncated` flag when the row cap is hit.
- `/unresolved` listing `AMBIGUOUS|UNRESOLVED` edges with their evidence.

Web (`path-list.tsx`):

- "From/To" object pickers seeded from search, path results as ordered lists
  (`A → CALLS → B → READS → T`), hop count per path, ordered-list semantics,
  link-out to each object and to source ranges.
- Unresolved references rendered with an explicit warning treatment and never
  presented as certain (per the evidence guidelines).

E2E: `tests/e2e/specs/plsql-analysis.spec.ts` starts here — search two
objects, request paths, assert the ordered path text and truncation handling.

**Acceptance:** identical path results across repeated runs (determinism
asserted in API tests); hop/row bounds enforced and surfaced.

---

## Phase 4 — Source evidence and read-only source viewer

Backend:

- `/source?objectId=…` and `/relationships/evidence?relationshipId=…` resolve
  evidence coordinates; `/files?fileId=…` returns read-only file content
  scoped under `plsql_source_root` with strict traversal guards and
  `plsql_max_source_bytes`.

Web (`source-viewer.tsx`):

- Dependency-free read-only viewer: line numbers, file path header, scroll to
  and highlight the requested range, copy-path action. Implemented with
  plain text rendering (no raw HTML); Monaco/CodeMirror remain out of scope
  (ADR 0014).
- Opening any evidence link navigates to the file with the range highlighted;
  on small screens the viewer uses the existing Sheet pattern.

API tests assert traversal rejection (`../`, absolute paths, symlink escape)
and byte caps; component tests assert highlight target and keyboard scroll
fallback.

**Acceptance:** navigation from every typed edge/impact row lands on the exact
file:line in the synthetic corpus.

---

## Phase 5 — Impact analysis

Backend: `/impact?objectId=…` — transitive dependents within
`plsql_max_hops`, grouped by distance, each item carrying its explaining
path(s) and evidence coordinates; no severity is persisted or fabricated —
scope is computed at query time from paths and relationship types (matching
the architecture principle and upstream ADR-009 intent).

Web (`impact-report.tsx`):

- Impact report rendered as grouped sections (direct/in-transit dependents,
  tables modified/read along paths) with explaining `source → relationship →
  target` paths and evidence links; a summary line mirrors the textual
  explainable-impact example of the source document (paths instead of bare
  counts).

**Acceptance:** API tests assert hop bound, grouping, and that every report
item has an explaining path; component tests assert report headings and
path rendering.

---

## Phase 6 — Hardening, docs, and deferred items

- Bounds sweep: every route tested at its cap (rows, hops, bytes, timeout);
  readiness matrix (`disabled/synthetic/connected/unavailable`) covered.
- Accessibility pass per `docs/graphify-enterprise-ux-guidelines.md` and
  `docs/ui/ui-guidelines.md`: keyboard flow, focus order, live region for
  analysis status, 44px targets, 320px + 200% zoom, WCAG 2.2 AA.
- Full E2E: extend the synthetic overlay and `tests/e2e/specs/` for search →
  detail → callers/callees → table access → paths → source → impact; update
  `tests/e2e/specs/helpers.ts` only additively.
- Docs sync: `docs/architecture/plsql-analysis-console.md`,
  `docs/architecture/contracts.md`, ADRs, README feature blurb, and
  `docs/troubleshooting.md` (analysis states).
- **Deferred (explicitly not in MVP, per ADR 0014):** interactive Cytoscape
  visualization (spike first: redundant-text parity, a11y, bundle impact, then
  a library-confirmation step), Monaco/CodeMirror source editor (revisit only
  if the read-only viewer fails the MVP bar), MCP parity for agents, and any
  new web dependency.

## Cross-phase acceptance hooks (accessible names for tests)

Follow the sentence-case conventions of `apps/web/docs/implementation-handoff.md`:

- Page heading: “PL/SQL analysis”
- Search label: “Search PL/SQL objects”; action: “Search objects”
- Statuses: “Analysis is not configured”, “Analysis is unavailable”, “Retry
  analysis query”
- Sections: “Callers”, “Callees”, “Table access”, “Dependency paths”,
  “Unresolved references”, “Impact analysis”, “Source”
- Empty: “No objects match”; truncation: “Results truncated”
- Resolution badges are text: `EXACT`, `INFERRED`, `AMBIGUOUS`, `UNRESOLVED`

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Upstream dependency extraction incomplete (real graphs may hold declarations only) | Deterministic fixtures carry dependency behavior; real mode documents the prerequisite; catalog pinned to the 2026-09-04 schema |
| Graph schema drift in `plsqlgraph` | Catalog + fixtures + contracts updated in lockstep; contracts versioned additively (ADR 0013) |
| Bolt driver adoption needs approval | Phase 0 gates it; synthetic mode is fully functional without it (ADR 0015) |
| Source content privacy/traversal | Read-only mount, strict root resolution, byte caps, server-side guards tested in phase 4 |
| Console diverges from chat-surface evidence conventions | Shared textual-first rules and component inventory reused; Cytoscape/editor deferred (ADR 0014) |
| `/ready` or smoke coupling | Analysis state is additive; legal-chat health paths unchanged (ADR 0015) |

## Out of scope (this plan)

MCP integration, graph writes/synchronization, incremental indexing, column
lineage, control-flow/trigger-chain visualization, per-project multi-graph
support, and any browser code-editor or graph library. All remain future
extensions per `docs/architecture/plsql-analysis-console.md` §15.
