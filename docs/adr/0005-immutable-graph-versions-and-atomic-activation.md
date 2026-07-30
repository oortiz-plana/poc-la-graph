# ADR 0005: Immutable Graph Versions and Atomic Activation

Status: accepted  
Date: 2026-07-28

## Context

Graph rebuilds can fail or produce partial files. Query processes must never
observe a half-written graph, and operators need a deterministic rollback.

## Decision

Publish each validated build into a new immutable version directory. Select the
query version through a schema-validated `active.json` pointer updated by
same-filesystem atomic rename and compare-and-swap generation. Verify the
reported Graphify version after reload/restart. Restore the prior pointer when
activation verification fails.

The manifest and pointer schemas in `contracts/knowledge` are frozen durable
contracts. The query response names the version actually used.

## Consequences

Rollback is fast and does not rebuild data. Storage grows until explicit
retention runs. Activation needs a small privileged component and
distribution-specific Graphify reload behavior. In-flight requests may finish
on the old version, but no response may mix versions.
