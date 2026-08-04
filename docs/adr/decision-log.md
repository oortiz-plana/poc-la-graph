# Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-28 | No authentication or authorization in POC | Explicitly out of scope |
| 2026-07-28 | Three long-running Compose services: web, api, graphify | Meets requirements without unnecessary infrastructure |
| 2026-07-28 | In-memory conversation store | Acceptable POC tradeoff; browser retains current conversation ID |
| 2026-07-28 | One configured Graphify project per deployment | Prevents model-controlled project/path selection |
| 2026-07-28 | Official MCP SDK and explicit four-operation allowlist | Avoids custom protocol implementation and arbitrary tools |
| 2026-07-28 | LiteLLM behind an internal interface | Provider-neutral OpenAI-compatible model configuration |
| 2026-07-28 | Standard named SSE events with JSON envelope | Typed incremental delivery compatible with web tooling |
| 2026-07-28 | Normalized public graph evidence | Prevents MCP schema leakage |
| 2026-07-28 | Insufficient evidence is a successful completed response | Distinguishes knowledge limitations from system failure |
| 2026-07-28 | Explicit mocks only | No silent production fallback |
| 2026-07-29 | Real Graphify is the default; synthetic Graphify requires an explicit overlay | Synthetic transport tests cannot be mistaken for real runtime compatibility |
| 2026-07-29 | Add one-shot knowledge initialization and ingestion jobs | Keeps graph generation outside the query runtime while preserving a simple Compose deployment |
| 2026-08-03 | Authenticated multi-project workspace ([ADR 0008](0008-authenticated-multi-project-workspace.md)) | Replaces bearer conversation capabilities and one configured corpus with role-gated, version-pinned projects |
| 2026-08-04 | Private project conversations ([ADR 0009](0009-private-project-conversations.md)) | Adds owner-scoped histories, stable resume ordering, naming, and reversible archive retention |
