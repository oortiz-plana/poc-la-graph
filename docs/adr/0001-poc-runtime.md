# ADR 0001: Minimal Docker Compose runtime

Status: Accepted

## Context

The source proposal describes production identity, policy, persistence, caching,
and Kubernetes components. The requested POC explicitly excludes authentication
and unnecessary infrastructure.

## Decision

Run `web`, `api`, and `graphify` in Docker Compose. Store conversations in API
memory. Configure one Graphify project per deployment. Do not include OIDC,
PostgreSQL, Valkey, an API gateway, or Kubernetes.

## Consequences

Startup and debugging remain small. Conversations disappear when the API restarts
and horizontal API scaling is unsupported. These are documented POC limitations,
not silent production behavior.

