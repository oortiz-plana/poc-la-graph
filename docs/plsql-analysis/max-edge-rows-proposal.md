# Proposal — Replace `MAX_EDGE_ROWS` with per-endpoint edge queries

Status: **implemented** (see "What shipped" at the end). This document records
the design rationale and the sizing math that motivated the change.

## Current design and why it hurts at real scale

`Neo4jPlsqlAnalysisClient._edges()`
(`apps/api/app/integrations/plsql/neo4j_client.py`) fetches **every typed edge
of the project** (`PROJECT_EDGES` in `catalog.py`, `LIMIT $limit` with
`MAX_EDGE_ROWS = 100_000`) and caches the full list in memory. Every endpoint
— callers, callees, table access, unresolved, relationship evidence, paths,
and impact — then filters that whole list in Python:

- `callers_of` / `callees_of` filter all edges for one `CALLS` endpoint.
- `table_access_of` scans all edges for member-prefix matches.
- `unresolved_references` filters all edges by resolution.
- `find_paths` builds a full adjacency map and walks it; `impact_of` does the
  same in reverse.

Against the confirmed live corpus (13,777 searchable objects) this means each
dependency, path, or impact request materializes and deserializes tens of
thousands of rows (14 columns each) to answer a question about one object,
while the API page size is only `plsql_max_rows ≤ 200`.

Additional problems with the current bound:

1. **`PROJECT_EDGES` has no `ORDER BY`.** When the row cap truncates, _which_
   edges are dropped is arbitrary, so pages, paths, and impact change between
   runs — the opposite of the deterministic-ordering guarantee the adapter
   documents.
2. **The limit heuristic is wrong at the boundary.** `len(rows) >=
MAX_EDGE_ROWS` raises `analysis_limit_exceeded` even when the project has
   exactly `MAX_EDGE_ROWS` edges, and never fires when it has fewer — while
   silently allowing a full 100k-row fetch and cache.
3. **`MAX_EDGE_ROWS = 100_000` contradicts the catalog's documented intent**
   (`MAX_PROJECT_EDGES = 20_000` in `catalog.py`, currently unused).
4. **Unbounded memory.** 100k rows × 14 string columns plus the Python
   `PlsqlDependencyRecord` objects ≈ 50–100 MB per gateway process, held
   forever in `_edge_cache`.

## Recommended design: push the filter into the catalog

Replace the load-everything cache with one parameterized catalog entry per
endpoint, each returning only the rows the endpoint needs, with
`LIMIT $limit + 1` (page size + 1) to compute `truncated` exactly, and a
deterministic `ORDER BY` matching the Python sort keys the console already
relies on (`relationship`, casefolded source qualified name, casefolded target
qualified name, id).

Sketch (each stays a static string with named parameters only, per ADR 0012):

- `EDGE_CALLERS`: `MATCH (s)-[r:CALLS]->(t)` where
  `t.projectId = $projectId AND t.qualifiedName = $qualifiedName`.
- `EDGE_CALLEES`: the same pattern reversed (`s.qualifiedName = $qualifiedName`).
- `EDGE_TABLE_ACCESS`: two branches — outgoing
  `READS|WRITES|TRIGGER_ON|VIEW_DEPENDS_ON` where `s.qualifiedName =
$qualifiedName OR s.qualifiedName STARTS WITH $qualifiedName + '.'` (the
  member semantics of `_is_or_member`), plus incoming where
  `t.qualifiedName = $qualifiedName OR ...` with a `Table`/`View` target.
- `EDGE_UNRESOLVED`: `WHERE r.resolution IN $resolutions`.
- `EDGE_BY_ID`: decode the opaque edge id (it already round-trips
  `relationship` + source/target qualified names via `_edge_parts`) and match
  those three properties directly.
- **Paths / impact**: keep the deterministic Python walk but feed it with an
  iterative bounded BFS over the _frontier only_: each round runs one query
  `MATCH (s)-[r]->(t) WHERE s.qualifiedName IN $frontier AND type(r) IN
$typedRelationships` (reverse direction for impact), at most
  `plsql_max_hops ≤ 5` rounds. This fetches only edges reachable from the
  anchors instead of the whole project.

Supporting changes:

- Confirm/create the index `DatabaseObject(projectId, qualifiedName)` in the
  catalog's schema-confirmation notes; all new entries are point/range lookups
  on it.
- Caching: either drop `_edge_cache` (each endpoint becomes 1–2 indexed Bolt
  round-trips) or replace it with a small per-request LRU keyed by endpoint
  parameters. Decide after measuring real-graph latency; do not cache
  whole-project edge lists.
- `MAX_EDGE_ROWS` becomes obsolete and is deleted; the effective per-query
  bound is `_effective_limit(settings, limit) + 1 ≤ 201` rows, and traversal
  is bounded by `max_hops × frontier size`.

## Interim option (keep the cache, minimal diff)

If the full redesign stays out of scope for now, at minimum:

1. **Align the cap with the documented intent.** Either set
   `MAX_EDGE_ROWS = MAX_PROJECT_EDGES` (20,000) or introduce a
   `PLSQL_MAX_EDGE_ROWS` setting. Sizing for the live corpus: a
   `COUNT_EDGES` query should be run once (`count(*)` of typed edges for the
   project). Typical PL/SQL corpora sit at roughly 1–4 edges per object, so
   13,777 objects suggests ≈ 14k–55k edges; a default of **50,000** (≈25–50 MB
   cached) is a reasonable bound with headroom, confirmed by the count.
2. **Replace the `>=` heuristic with a count.** Run `COUNT_EDGES`; raise
   `analysis_limit_exceeded` only when the count exceeds the bound, and fetch
   with `LIMIT count + 1` as a sanity check.
3. **Add `ORDER BY` to `PROJECT_EDGES`** so truncation, when it happens, is
   deterministic and matches the Python sort keys.
4. **Filter rows before enforcing the cap** (`_dependency_from_row` skips
   malformed rows), so garbage rows never count toward the bound.

There is no single "optimal" constant independent of the corpus: with the
per-endpoint design the question disappears (bound = page size + 1), and with
the cache it should be derived from the measured edge count (`COUNT_EDGES`)
plus headroom, not picked a priori.

## Impact on the console and tests

- `truncated` becomes exact (`LIMIT + 1`) instead of a cap heuristic; ordering
  stays deterministic across calls — a user-visible improvement for paths and
  impact.
- `analysis_limit_exceeded` (503) semantics are unchanged, and the console UI
  already renders that code distinctly with no retry button (the Fix 3 change
  in this same change set), so no contract change is needed.
- Test plan: extend `apps/api/tests/plsql/test_plsql_neo4j_api.py` to cover
  per-endpoint queries (truncation at `limit + 1`, stable ordering, member
  semantics for table access, unresolved filtering), and adapt any assertions
  that depend on the `len(rows) >= MAX_EDGE_ROWS` heuristic.

## What shipped

- `catalog.py`: `PROJECT_EDGES` and `MAX_PROJECT_EDGES` are gone. New entries:
  `EDGE_CALLERS`/`EDGE_CALLEES`/`EDGE_TABLE_ACCESS`/`EDGE_UNRESOLVED` with
  `COUNT_*` twins (shared filters, so totals and pages always agree),
  `EDGE_BY_TRIPLE` for relationship evidence, `EDGE_OUTGOING`/`EDGE_INCOMING`
  for frontier expansion, and `EDGE_MEMBER_ENDPOINTS` for package-member
  anchors. All selects carry the deterministic `EDGE_ORDER`
  (`type(r)`, casefolded source, casefolded target) matching the client's
  sort keys.
- `neo4j_client.py`: `_edges()`/`_edge_cache`/`MAX_EDGE_ROWS` are deleted.
  Dependency lists run the targeted select (`LIMIT page + 1`) plus its count
  twin; `find_paths` and `impact_of` expand one bounded frontier per hop and
  raise `PlsqlLimitExceeded` when the traversal budget is exceeded (also
  fixing a latent `object_id` parameter-shadowing bug in `impact_of`).
- `settings.py`/`dependencies.py`: the budget is the
  `plsql_max_traversal_edges` Settings parameter (default `20_000`, range
  1–1,000,000), passed to the client as `max_traversal_edges` — a config
  parameter alongside `plsql_max_hops`/`plsql_max_rows`, not a hardcoded
  catalog constant.
- Tests: `tests/plsql/test_plsql_neo4j_adapter.py` gained hermetic coverage
  for the targeted selects (params, truncation, totals), triple-based
  evidence lookup, bounded frontier expansion for paths and impact, package
  member anchors, and the traversal-budget error.
