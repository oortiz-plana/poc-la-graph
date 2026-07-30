# ADR 0007: Separate Ingestion from the Chat Query Plane

Status: accepted  
Date: 2026-07-28

## Context

Uploads and graph builds handle hostile bytes, require filesystem writes and
substantial resources, and may need source-system credentials. Chat retrieval
must remain bounded and read-only.

## Decision

Keep ingestion/build/activation in a separate control plane. The POC does not
expose uploads. A future ingestion service uses opaque storage identifiers,
isolated workers, project-scoped permissions, immutable publication, and a
separately authorized activation operation.

The chat API and LLM receive no upload, build, activation, arbitrary URL, or
filesystem tool. Their Graphify access remains the four-operation allowlist.

## Consequences

The query service retains a small attack surface and can run with read-only
knowledge mounts. A production upload feature requires identity, authorization,
job persistence, scanning, retention, and audit services before it is enabled.
