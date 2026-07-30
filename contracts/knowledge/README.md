# Frozen Knowledge Contracts

Frozen: 2026-07-28.

These schemas describe the durable handoff between a future ingestion/control
plane and the Graphify query runtime:

- `graph-build-manifest.schema.json` describes an immutable validated build.
- `active-pointer.schema.json` describes the atomically replaceable selection.

They do not alter the public chat API or the internal
`GraphKnowledgeClient`. `graphVersion` in an answer is the opaque version
reported by the selected Graphify runtime and should equal the active
manifest's `graphVersion` for queries begun after successful activation.

Contract changes require a new ADR. Readers must reject unknown schema versions
and fail closed; producers may add only fields permitted by a later schema.
