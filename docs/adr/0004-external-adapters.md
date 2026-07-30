# ADR 0004: External systems behind internal interfaces

Status: Accepted

## Context

Provider-native structures would couple workflow and UI code to Graphify or a
specific model vendor.

## Decision

Use the official MCP Python SDK behind `GraphKnowledgeClient` and LiteLLM behind
an internal model client. Normalize outputs and errors at adapter boundaries.
Mocks implement the same interfaces and activate only through explicit test or
troubleshooting configuration.

## Consequences

Workflow tests are deterministic and providers can change independently.
Adapters carry the responsibility for schema validation, limits, error
sanitization, and usage metadata.

