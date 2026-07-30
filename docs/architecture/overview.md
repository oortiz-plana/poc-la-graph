# Graphify Knowledge Agent POC Architecture

Status: initial contracts frozen on 2026-07-28.

## Scope and assumptions

This POC exposes an unauthenticated browser chat over a FastAPI backend. The
backend is the sole caller of Graphify MCP and the model provider. Conversations
live in API process memory and are lost on restart. A single configured Graphify
project is available per deployment. Graphify and the LLM are real production
adapters; deterministic substitutes are enabled only by explicit test or
troubleshooting configuration.

## Components

```mermaid
flowchart LR
    U[Browser user] --> W[Next.js web UI<br/>Vercel AI SDK]
    W -->|JSON + SSE<br/>typed public contract| A[FastAPI agent API]
    A --> C[(In-memory<br/>conversation store)]
    A --> G[Bounded LangGraph workflow]
    G --> L[Internal model interface<br/>LiteLLM adapter]
    G --> K[GraphKnowledgeClient]
    K -->|Official MCP SDK<br/>allowlisted tools only| M[Graphify MCP server]
    M --> P[(Mounted sample<br/>knowledge project)]
    A -.-> O[Structured logs and<br/>OpenTelemetry spans]
    G -.-> O
    K -.-> O
    L -.-> O
```

The browser has no Graphify URL or LLM credentials. Public models in
`contracts/schemas` contain normalized graph evidence and never MCP-native
payloads.

## Runtime interaction

```mermaid
sequenceDiagram
    actor User
    participant Web as Next.js UI
    participant API as FastAPI
    participant Store as Conversation store
    participant Agent as LangGraph workflow
    participant MCP as Graphify adapter
    participant Graphify as Graphify MCP
    participant LLM as LiteLLM adapter

    User->>Web: Submit question
    Web->>API: POST conversation message
    API->>Store: Validate conversation and append user message
    API-->>Web: message.started
    API-->>Web: tool.started (graphify.search)
    Agent->>MCP: search(question)
    MCP->>Graphify: allowlisted MCP tool call
    Graphify-->>MCP: native tool result
    MCP-->>Agent: normalized evidence
    API-->>Web: tool.completed
    opt evidence expansion is bounded and useful
        Agent->>MCP: get_neighbors / shortest_path
        MCP->>Graphify: allowlisted MCP tool call
        Graphify-->>MCP: native result
        MCP-->>Agent: normalized subgraph
    end
    alt sufficient evidence
        Agent->>LLM: question + delimited evidence
        LLM-->>Agent: grounded structured answer
        Agent->>Agent: validate citations against evidence
        loop answer chunks
            API-->>Web: answer.delta
        end
        API-->>Web: citation.available
        API-->>Web: message.completed
        API->>Store: Persist completed assistant message
    else insufficient evidence
        API-->>Web: answer.delta (concise explanation)
        API-->>Web: message.completed (confidence=insufficient)
        API->>Store: Persist insufficient response
    else dependency or validation failure
        API-->>Web: message.failed (normalized error)
        API->>Store: Persist failed message metadata
    end
```

## Boundaries

- `apps/web` owns presentation, browser-session conversation selection, Markdown
  rendering, and validated consumption of public contracts.
- `apps/api/app/api`, `models`, and `config` own HTTP/SSE, validation, request
  correlation, configuration, and conversation persistence.
- `apps/api/app/agent` owns bounded orchestration and grounding policy.
- `apps/api/app/integrations/graphify` alone understands Graphify MCP schemas.
- `apps/api/app/integrations/llm` alone understands LiteLLM/provider behavior.
- `contracts` is descriptive and frozen for the initial POC. Runtime types should
  conform to it; contract changes require an ADR and coordinated frontend/backend
  update.

## Failure and readiness model

`/health` reports process liveness. `/ready` confirms application initialization,
conversation store availability, and Graphify adapter configuration. It may
report dependency details without requiring a live LLM request. Per-message
Graphify, MCP, LLM, timeout, malformed-response, and interrupted-stream failures
use the normalized `message.failed` contract.

## Grounding and safety invariants

1. Only the four operations in the MCP contract are callable.
2. Project ID and project path come only from trusted configuration.
3. Retrieved graph content is untrusted data, delimited from model instructions.
4. Tool calls, traversal depth, evidence bytes, nodes, edges, model iterations,
   and total time are bounded by backend configuration.
5. A returned citation must match retrieved evidence; invalid citations are
   removed and may force `confidence=insufficient`.
6. No private reasoning or chain-of-thought is included in events or logs.

