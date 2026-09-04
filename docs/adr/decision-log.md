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
| 2026-08-04 | Tenant-scoped project access ([ADR 0010](0010-tenant-project-access.md)) | Replaces organization-wide visibility with private user/group grants, protected ownership, requests, and audited changes |
| 2026-09-04 | PL/SQL analysis console as an authenticated workspace ([ADR 0011](0011-plsql-analysis-console-workspace.md)) | Adds a `/plsql` developer console to the existing shell without coupling to legal-chat projects, conversations, or knowledge builds |
| 2026-09-04 | Deterministic read-only analysis gateway; no MCP, no raw Cypher ([ADR 0012](0012-plsql-read-only-analysis-gateway.md)) | Owns Neo4j access behind an allowlisted query-path catalog with bounded, deterministic results; MCP integration deferred |
| 2026-09-04 | PL/SQL analysis contract, evidence, and identifier rules ([ADR 0013](0013-plsql-analysis-contract.md)) | Freezes a camelCase `/api/v1/plsql` surface validated by Pydantic, JSON Schema/OpenAPI, and Zod; follows the implemented graph vocabulary |
| 2026-09-04 | Textual-first analysis UI; graph and editor deferred ([ADR 0014](0014-plsql-textual-first-ui-deferred-graph.md)) | Mandatory structured text views; interactive graph and code editor deferred behind spikes and dependency confirmation |
| 2026-09-04 | PL/SQL console runtime and test topology ([ADR 0015](0015-plsql-console-runtime-and-test-topology.md)) | Default compose unchanged (`PLSQL_ADAPTER=disabled`); synthetic fixture mode for dev/E2E; real Neo4j opt-in via server-side env |
