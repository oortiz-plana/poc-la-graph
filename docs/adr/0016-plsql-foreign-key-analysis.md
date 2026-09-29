# ADR 0016: Foreign keys in PL/SQL dependency analysis

- Status: accepted
- Date: 2026-09-29

## Context

The analysis graph already stores `FOREIGN_KEY` edges between tables. The
analysis gateway's enums and traversal allowlists excluded them, hiding
structural dependencies from Dependencies, Paths, and Impact.

## Decision

Expose `FOREIGN_KEY` with its stored direction: **referencing table → referenced
table**. Include incoming and outgoing edges in Dependencies under **Other**,
and include foreign keys in default directed Paths and Impact traversals.
Upstream impact from a referenced table reaches referencing tables; downstream
impact follows the stored arrow. The Impact relationship filter also accepts
`FOREIGN_KEY` explicitly.

Foreign keys express structural dependency. They do not imply writes or
cascading deletes. `writesOnly` continues to select only `WRITES`, taking
precedence over the relationship filter. Only `WRITES` contributes to tables
modified. Existing bounds, cycle prevention, pagination, project scoping, and
evidence handling remain in effect. Missing evidence stays unavailable.

## Compatibility and rollout

This extends closed response/request enums and expands default traversal
semantics, so older validating browsers are incompatible with new edge values.
Keep `/api/v1/plsql` and deploy matching API and browser builds together; refresh
open browser sessions after deployment. Roll back both builds together. No
stored-graph migration or re-extraction is needed. Discard in-flight pagination
cursors across deployment and restart the query because the default traversal
result set can change. No new category, endpoint, or FK metadata is introduced.

## Verification

Synthetic tables and source evidence exercise both directions, explicit and
writes-only filters, paths, cycles, and pagination. Hermetic Neo4j tests verify
query parameters and row mapping; these do not establish live graph alignment.
Browser checks cover validation, labels, evidence, and the Impact selector.
