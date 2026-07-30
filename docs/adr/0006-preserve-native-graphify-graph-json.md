# ADR 0006: Preserve Graphify-Native `graph.json`

Status: accepted  
Date: 2026-07-28

## Context

The application needs a durable knowledge artifact. Defining a second canonical
graph format would duplicate Graphify semantics and require custom conversion,
validation, and compatibility logic.

## Decision

The canonical graph artifact is the native `graph.json` produced and consumed
by the selected Graphify distribution. The application does not rewrite its
nodes, edges, indexes, or metadata. It adds a sidecar build manifest containing
identity, producer/format version, checksum, size, counts, and source version.

Only the Graphify runtime reads native graph content. The API continues to see
adapter-normalized evidence through official MCP. Native structures never
cross the browser contract.

## Consequences

This avoids inventing a graph protocol and preserves compatibility with
Graphify tooling. Artifact validation and migration depend on the selected
Graphify version. Upgrading Graphify therefore requires a compatibility build
and query test before activation; the sidecar manifest makes that dependency
explicit.
