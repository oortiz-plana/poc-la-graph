# Implement a Graphify Knowledge Agent POC

Act as the lead software architect and implementation coordinator. Build a working proof of concept that exposes a web-based conversational agent capable of answering questions using knowledge stored in Graphify.

Use multiple specialized subagents and parallel workstreams wherever possible. Each subagent must have a clear responsibility, explicit file ownership, concrete deliverables, and validation criteria.

Do not implement functionality from scratch when an established open-source library is available.

## 1. Objective

Implement a Docker-based POC with:

* A web UI where users can ask questions.
* A backend agent API.
* An agent workflow that queries Graphify through MCP.
* Streaming answers.
* Source citations and graph evidence.
* Conversation history for the current browser session.
* Docker Compose for local startup.
* Automated tests.
* Clear documentation.

Authentication and authorization are explicitly out of scope.

The complete solution must start with:

```bash
docker compose up --build
```

After startup:

* Web UI: `http://localhost:3000`
* Backend API: `http://localhost:8000`
* API documentation: `http://localhost:8000/docs`

## 2. Required technology stack

Use the following stack unless an existing repository already contains an equivalent, compatible framework.

### Frontend

* Next.js
* React
* TypeScript
* Vercel AI SDK for chat and streaming
* shadcn/ui for reusable UI components
* Tailwind CSS
* React Markdown for Markdown rendering
* Zod for client-side contract validation
* Cytoscape.js or React Flow for optional graph evidence visualization

### Backend

* Python 3.12
* FastAPI
* Pydantic
* LangGraph for agent orchestration
* Official Model Context Protocol Python SDK
* HTTPX for HTTP calls
* Server-Sent Events or an AI SDK-compatible streaming protocol
* Structured logging
* OpenTelemetry instrumentation where practical

### LLM integration

Use LiteLLM or the LiteLLM Python SDK as the model abstraction layer.

The implementation must support an OpenAI-compatible model through environment variables:

```env
LLM_MODEL=
LLM_API_BASE=
LLM_API_KEY=
```

Do not couple the application directly to one model provider.

### Graphify integration

Graphify must be accessed through its MCP server.

Support configuration such as:

```env
GRAPHIFY_MCP_TRANSPORT=http
GRAPHIFY_MCP_URL=http://graphify:8001/mcp
GRAPHIFY_PROJECT_ID=sample-project
GRAPHIFY_PROJECT_PATH=/knowledge/sample-project
GRAPHIFY_REQUEST_TIMEOUT_SECONDS=20
```

Create an internal Graphify adapter. Do not expose Graphify MCP response structures directly to the frontend.

### Infrastructure

* Docker
* Docker Compose
* Multi-stage Dockerfiles
* Health checks
* `.env.example`
* Named volumes where needed

Avoid Kubernetes, cloud services, authentication servers, Kafka, and other infrastructure that is unnecessary for the POC.

## 3. Mandatory engineering principles

1. Use libraries instead of creating protocols or frameworks from scratch.
2. Do not implement a custom MCP client.
3. Do not implement a custom chat-streaming framework.
4. Do not create a custom UI component library.
5. Do not let the LLM access arbitrary tools, files, URLs, or shell commands.
6. Use an explicit Graphify tool allowlist.
7. Keep frontend, backend, Graphify integration, and agent orchestration separated.
8. All external dependencies must be abstracted behind interfaces.
9. Use typed contracts across service boundaries.
10. Make the POC runnable without authentication.
11. Do not expose model API keys or Graphify credentials to the browser.
12. Prefer simple, readable code over premature abstraction.
13. Do not leave placeholder implementations in the primary execution path.
14. Add a deterministic mock Graphify adapter only for automated tests and local troubleshooting.
15. Do not silently fall back to the mock adapter in normal runtime mode.

## 4. Subagent organization

Create as many concurrent subagents as the environment safely supports. At minimum, create the following specialized subagents.

Two subagents must not edit the same files concurrently. Assign explicit file ownership before implementation begins.

### Subagent 1: Solution Architect

Responsibilities:

* Inspect the repository.
* Confirm the target architecture.
* Define component boundaries.
* Define runtime interactions.
* Create architecture decision records.
* Define API and event-stream contracts.
* Define shared data models.
* Coordinate dependencies between workstreams.

Primary ownership:

```text
docs/architecture/
docs/adr/
contracts/
```

Deliverables:

* Architecture overview.
* Component diagram using Mermaid.
* Sequence diagram using Mermaid.
* API contract.
* MCP integration contract.
* Decision log.

This subagent must complete the contracts before frontend and backend agents finalize their implementations.

### Subagent 2: UI/UX Designer

Responsibilities:

* Define the UI information architecture.
* Define the chat interaction model.
* Define loading, streaming, error, empty, and insufficient-evidence states.
* Define source citation presentation.
* Define graph evidence presentation.
* Create concise visual and accessibility guidelines.

Primary ownership:

```text
docs/ui/
apps/web/docs/
```

Deliverables:

* UI guidelines.
* Component inventory.
* Screen layout.
* Responsive behavior.
* Accessibility requirements.
* Interaction-state definitions.

This agent defines guidelines but does not implement production UI components.

### Subagent 3: Frontend Implementer

Responsibilities:

* Implement the Next.js application.
* Implement streaming chat.
* Display assistant Markdown.
* Display citations.
* Display Graphify evidence.
* Implement conversation reset.
* Implement backend connection status.
* Follow the UI/UX guidelines.

Primary ownership:

```text
apps/web/
```

Required UI regions:

* Application header.
* Knowledge project indicator.
* Conversation panel.
* Message composer.
* Streaming-status indicator.
* Citation/evidence drawer.
* Error and retry states.
* Optional graph-path visualization.

Do not expose raw chain-of-thought or private model reasoning.

### Subagent 4: Frontend Test Engineer

Responsibilities:

* Create frontend unit and component tests.
* Test streaming behavior.
* Test citations.
* Test empty and error states.
* Test keyboard accessibility.
* Test responsive behavior where practical.

Primary ownership:

```text
apps/web/**/*.test.*
apps/web/tests/
```

Use established testing libraries such as:

* Vitest
* React Testing Library
* Playwright

### Subagent 5: Backend API Engineer

Responsibilities:

* Implement the FastAPI application.
* Implement health and readiness endpoints.
* Implement conversation and message endpoints.
* Implement streaming responses.
* Add validation and normalized error handling.
* Add request and correlation IDs.
* Generate usable OpenAPI documentation.

Primary ownership:

```text
apps/api/app/api/
apps/api/app/main.py
apps/api/app/models/
apps/api/app/config/
```

Minimum endpoints:

```http
GET /health
GET /ready
POST /api/v1/conversations
POST /api/v1/conversations/{conversation_id}/messages
GET /api/v1/conversations/{conversation_id}
DELETE /api/v1/conversations/{conversation_id}
```

The message endpoint must support streaming.

### Subagent 6: Agent Workflow Engineer

Responsibilities:

* Implement the LangGraph workflow.
* Define typed workflow state.
* Implement bounded tool usage.
* Implement evidence collection.
* Implement answer generation.
* Implement citation validation.
* Handle insufficient evidence.

Primary ownership:

```text
apps/api/app/agent/
apps/api/app/prompts/
```

Implement explicit workflow nodes similar to:

```text
validate_request
    ↓
classify_question
    ↓
plan_graph_query
    ↓
query_graphify
    ↓
expand_graph_evidence
    ↓
prepare_context
    ↓
generate_answer
    ↓
validate_grounding
    ↓
format_response
```

Set limits for:

* Maximum Graphify tool calls.
* Maximum traversal depth.
* Maximum nodes and edges.
* Maximum evidence size.
* Maximum model iterations.
* Overall request timeout.

The workflow must return an insufficient-evidence response when Graphify does not provide enough information.

### Subagent 7: Graphify/MCP Integration Engineer

Responsibilities:

* Implement the Graphify adapter using the official MCP SDK.
* Manage MCP connections.
* Implement the tool allowlist.
* Normalize Graphify results.
* Apply timeouts and result-size limits.
* Provide mock fixtures for tests.
* Prevent arbitrary project paths.

Primary ownership:

```text
apps/api/app/integrations/graphify/
tests/fixtures/graphify/
```

Create an internal interface similar to:

```python
class GraphKnowledgeClient(Protocol):
    async def search(self, query: str) -> GraphSearchResult:
        ...

    async def get_node(self, node_id: str) -> GraphNode:
        ...

    async def get_neighbors(
        self,
        node_id: str,
        depth: int = 1,
    ) -> GraphSubgraph:
        ...

    async def shortest_path(
        self,
        source_node_id: str,
        target_node_id: str,
    ) -> GraphPath:
        ...
```

Only enable Graphify tools required by the POC.

Never allow an LLM-generated filesystem path to be passed to Graphify.

### Subagent 8: LLM Integration Engineer

Responsibilities:

* Implement the LiteLLM abstraction.
* Support OpenAI-compatible providers.
* Configure timeouts and retries.
* Implement model response schemas where practical.
* Track token usage.
* Sanitize provider errors.

Primary ownership:

```text
apps/api/app/integrations/llm/
```

The rest of the application must depend on an internal model interface, not directly on provider-specific SDKs.

### Subagent 9: Docker and Developer Experience Engineer

Responsibilities:

* Create Dockerfiles.
* Create Docker Compose configuration.
* Configure service networking.
* Add health checks.
* Add hot-reload configuration for local development where reasonable.
* Create `.env.example`.
* Add Makefile or task-runner commands.
* Validate clean startup from a new checkout.

Primary ownership:

```text
docker-compose.yml
compose/
docker/
Makefile
.env.example
scripts/
```

Expected services:

```text
web
api
graphify
```

Add PostgreSQL or Valkey only if the implementation actually requires them. For the POC, in-memory conversation storage is acceptable if documented clearly.

### Subagent 10: Backend Test Engineer

Responsibilities:

* Create unit tests.
* Create API integration tests.
* Create agent workflow tests.
* Mock the LLM deterministically.
* Mock Graphify through the internal adapter.
* Test timeouts and malformed tool responses.
* Test insufficient-evidence behavior.

Primary ownership:

```text
apps/api/tests/
```

Use established tools:

* pytest
* pytest-asyncio
* HTTPX test client
* respx where applicable

### Subagent 11: End-to-End Test Engineer

Responsibilities:

* Implement end-to-end tests against the composed system.
* Validate UI-to-backend streaming.
* Validate citation rendering.
* Validate failure when Graphify is unavailable.
* Validate recovery after restarting a dependency.

Primary ownership:

```text
tests/e2e/
```

Use Playwright unless the repository already uses an equivalent tool.

### Subagent 12: Quality and Security Reviewer

Responsibilities:

* Review input validation.
* Review prompt-injection boundaries.
* Review secret handling.
* Review dependency usage.
* Review logging for sensitive information.
* Review Docker container permissions.
* Review error disclosure.
* Run static analysis.

Primary ownership:

```text
docs/reviews/
```

This subagent should primarily review and report. Any required code changes must be assigned to the owning implementation agent.

### Subagent 13: Technical Writer

Responsibilities:

* Create the root README.
* Document setup and configuration.
* Document Graphify preparation.
* Document architecture.
* Document troubleshooting.
* Document testing commands.
* Document limitations.

Primary ownership:

```text
README.md
docs/getting-started.md
docs/troubleshooting.md
```

### Subagent 14: Integration Reviewer

Responsibilities:

* Review all deliverables after implementation.
* Resolve contract inconsistencies.
* Execute the full test suite.
* Execute Docker Compose startup.
* Verify acceptance criteria.
* Produce the final implementation report.

This subagent must not redesign the system unless a blocking issue is identified.

## 5. Subagent coordination protocol

Before implementation:

1. Inspect the repository.
2. Create a short implementation plan.
3. Assign file ownership.
4. Identify tasks that can run concurrently.
5. Have the architecture agent define shared contracts.
6. Freeze the initial contracts before parallel implementation begins.

During implementation:

* Use separate worktrees or isolated branches when available.
* Do not allow simultaneous edits to shared files.
* Keep commits small and scoped to one responsibility.
* Record assumptions in documentation.
* Prefer resolving issues directly instead of asking unnecessary questions.
* Notify the integration reviewer of contract changes.
* Run focused tests after each workstream.

After implementation:

1. Merge the workstreams.
2. Run formatters and linters.
3. Run frontend tests.
4. Run backend tests.
5. Run end-to-end tests.
6. Build all Docker images.
7. Start the complete environment.
8. Run a smoke-test question.
9. Verify citations.
10. Stop and restart the environment to verify reproducibility.

## 6. Functional requirements

### Chat behavior

The user must be able to:

* Enter a question.
* Submit using the keyboard or button.
* See the user message immediately.
* See streamed assistant content.
* See when Graphify is being queried.
* Inspect citations after the answer.
* Reset the conversation.
* Retry a failed request.

### Answer contract

Each completed response should contain:

```json
{
  "requestId": "string",
  "conversationId": "string",
  "answer": "string",
  "status": "completed",
  "confidence": "high | medium | low | insufficient",
  "graphVersion": "string | null",
  "citations": [
    {
      "id": "string",
      "title": "string",
      "source": "string",
      "nodeId": "string | null",
      "relationship": "string | null",
      "provenance": "explicit | extracted | inferred | unknown",
      "excerpt": "string | null"
    }
  ],
  "graphEvidence": {
    "nodes": [],
    "edges": [],
    "paths": []
  },
  "warnings": []
}
```

For streaming, define equivalent event types:

```text
message.started
tool.started
tool.completed
answer.delta
citation.available
message.completed
message.failed
```

### Grounding requirements

* Every material claim should be supported by retrieved Graphify evidence.
* Clearly label inferred relationships.
* Never fabricate citations.
* Never fabricate graph nodes or edges.
* Return an insufficient-evidence result when needed.
* Do not expose chain-of-thought.
* A concise explanation of evidence is acceptable.

### Error handling

Provide clear handling for:

* Graphify unavailable.
* MCP timeout.
* LLM unavailable.
* Invalid model response.
* Empty graph result.
* Request timeout.
* Invalid API input.
* Interrupted stream.

## 7. Graphify configuration

Assume a sample Graphify project is mounted into the Graphify container.

Document how to:

1. Prepare or generate the Graphify knowledge graph.
2. Mount the graph project into Docker Compose.
3. Configure the MCP server.
4. Validate MCP connectivity.
5. Run a sample Graphify query.
6. Point the agent API to another Graphify project.

Do not commit real API keys or proprietary source code.

Provide a small synthetic sample knowledge project or fixture that can be safely committed if Graphify permits it.

## 8. Suggested repository structure

```text
graphify-agent-poc/
├── apps/
│   ├── web/
│   └── api/
├── contracts/
│   ├── openapi/
│   └── events/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── ui/
│   └── reviews/
├── graphify/
│   ├── sample/
│   └── README.md
├── tests/
│   ├── e2e/
│   └── fixtures/
├── docker/
├── scripts/
├── docker-compose.yml
├── Makefile
├── .env.example
└── README.md
```

Adapt this structure if the repository already has an established layout.

## 9. Testing requirements

### Backend unit tests

Cover:

* Workflow routing.
* Graph query planning.
* Graphify result normalization.
* Tool-call limits.
* Timeout behavior.
* Citation validation.
* Insufficient-evidence responses.
* Provider-error normalization.

### Frontend tests

Cover:

* Message submission.
* Streaming deltas.
* Tool status.
* Citation display.
* Error display.
* Retry.
* Conversation reset.

### Integration tests

Cover:

* FastAPI plus mock Graphify.
* FastAPI plus mock LLM.
* Stream event ordering.
* Invalid MCP responses.
* Graphify downtime.

### End-to-end tests

Cover at least:

1. User submits a question.
2. UI displays Graphify activity.
3. Answer streams into the UI.
4. Citations are shown.
5. Evidence drawer opens.
6. Conversation can be reset.
7. Graphify failure is displayed cleanly.

## 10. Code quality

Configure and run:

### Python

* Ruff
* Black, unless Ruff formatting is used
* mypy or Pyright
* pytest

### TypeScript

* ESLint
* Prettier
* TypeScript strict mode
* Vitest
* Playwright

Do not suppress type errors broadly.

Avoid:

* Files containing multiple unrelated responsibilities.
* Large route handlers.
* Global mutable state beyond an explicitly documented POC conversation store.
* Hard-coded service URLs.
* Provider-specific model logic outside the LLM adapter.
* Graphify-specific response objects outside the Graphify adapter.

## 11. Docker requirements

Use multi-stage builds.

Containers should:

* Run as non-root where practical.
* Include health checks.
* Use environment variables for configuration.
* Avoid embedding secrets.
* Expose only required ports.
* Log to standard output.
* Shut down gracefully.

The API readiness check must verify that required application dependencies are initialized. It does not need to block startup solely because the LLM provider is temporarily unavailable.

Provide commands such as:

```bash
make setup
make dev
make test
make lint
make e2e
make down
```

## 12. Acceptance criteria

The POC is complete only when all of the following are true:

* `docker compose up --build` starts the complete solution.
* The web UI loads at port 3000.
* The FastAPI service loads at port 8000.
* OpenAPI documentation is available.
* A question can be submitted from the UI.
* The backend queries Graphify through MCP.
* The response is streamed.
* The response includes citations or explicitly reports insufficient evidence.
* The browser never receives the model API key.
* The browser never connects directly to Graphify.
* Unit tests pass.
* Integration tests pass.
* End-to-end smoke tests pass.
* Docker health checks pass.
* README setup instructions work from a clean checkout.
* There are no critical TODOs in the main execution path.
* No authentication implementation is included.
* No proprietary source code or credentials are committed.

## 13. Implementation behavior

Do not stop after producing a plan or scaffolding.

Implement the working POC, execute tests, fix failures, and verify the Docker environment.

When information is missing:

* Inspect the repository first.
* Use reasonable assumptions.
* Record assumptions.
* Prefer configurable defaults.
* Do not block implementation for minor ambiguities.

When a dependency is unavailable during automated tests:

* Mock it through the internal abstraction.
* Keep the production integration fully implemented.
* Clearly document what requires a real Graphify instance or LLM provider.

## 14. Final response

At the end, provide:

1. Implementation summary.
2. Architecture summary.
3. List of subagents used and their deliverables.
4. Repository structure.
5. Main technical decisions.
6. Commands to run the solution.
7. Test results.
8. Known limitations.
9. Remaining production-readiness work.
10. Any assumptions made.

Do not claim that a command, test, or Docker startup succeeded unless it was actually executed successfully.
