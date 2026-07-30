# ADR 0002: Typed Server-Sent Events

Status: Accepted

## Context

Answers, tool activity, citations, and terminal metadata must arrive
incrementally and be consumable by the Vercel AI SDK without inventing a
transport protocol.

## Decision

Use standard SSE (`text/event-stream`) with the typed event envelope in
`contracts/events/sse-events.schema.json`. The API emits named SSE events and
JSON data. The Vercel AI SDK is used by the frontend for chat state and stream
consumption; the backend uses established SSE support.

## Consequences

The stream is unidirectional and naturally works over HTTP. Reconnection does
not resume a partially generated response in this in-memory POC; the UI offers
retry. Proxies must disable response buffering.

