# Graphify Knowledge Agent POC

The default Compose stack now pins the actual open-source
`graphifyy==0.9.18` runtime and `haystack-ai==2.31.0`. It discovers the four
Spanish legal Markdown documents under `knowledge/input`, builds a native
Graphify `graph.json`, indexes the original article and paragraph text in
SQLite FTS5, starts Graphify's Streamable HTTP MCP server, and serves grounded
hybrid-retrieval chat through FastAPI and Next.js.

Graphify semantic extraction requires a valid provider credential. Copy
`.env.example` to `.env`, set `OPENAI_API_KEY` (and provider/model overrides
when applicable), then run:

```bash
docker compose up --build
```

Graphify itself is MIT-licensed open source and needs no license key. The
credential above is for the LLM used during semantic document extraction.

The normal startup deliberately fails if real graph generation fails. The
deterministic server is available only through:

```bash
docker compose -f docker-compose.yml -f docker-compose.synthetic.yml up --build
```

See [knowledge ingestion](docs/knowledge-ingestion.md) and the
[verified package/runtime report](docs/graphify/package-runtime-compatibility.md).

## Start

Requirements: Docker Engine with Docker Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

When the services are healthy:

- Web UI: <http://localhost:3000>
- Backend API: <http://localhost:8000>
- OpenAPI documentation: <http://localhost:8000/docs>

The first image build downloads Python, Node, and application dependencies.
Ask a sample question such as:

> ¿Qué establece la Ley 100 de 1993 sobre el sistema general de pensiones?

For an article-level text retrieval example:

> Según el Artículo 49, ¿quiénes son los posibles beneficiarios?

With `LLM_ADAPTER=litellm`, answers use the configured model. With
`LLM_ADAPTER=mock`, deterministic answers exercise streaming and citation
contracts without an external answer model.

## Runtime architecture

The browser talks only to Next.js routes. Next.js proxies conversation calls and
converts the backend's typed SSE lifecycle events to the Vercel AI SDK data
stream. FastAPI owns a durable SQLAlchemy conversation store and invokes a
bounded LangGraph workflow. The workflow resolves follow-up references from a
sanitized history window, retrieves fresh Graphify evidence for every answer,
uses that evidence to bound Haystack BM25 retrieval over the original source
passages, and then calls the internal model interface implemented with LiteLLM.

Graphify remains the authoritative entity and relationship graph. Haystack does
not replace Graphify or add another network service: a persistent SQLite FTS5
index under `/knowledge/state` is the canonical source-text store, while an
ephemeral Haystack document store ranks only the allowlisted passages for the
current request.

```text
Graphify nodes, edges, and paths
              +
bounded legal source passages
              ↓
       grounded answer
```

The retrieval boundary is deliberately one-way:

- Graphify runs first and determines the allowed source documents and articles.
- Haystack cannot retrieve passages from another document or expand that scope.
- Relationship claims require graph citations.
- Article contents and other textual legal claims require exact source-passage
  citations with document, article, paragraph, and line metadata.
- Missing article passages produce an insufficient-evidence response instead of
  an answer inferred from graph labels.

In the web UI, citations retrieved through Haystack are labeled
`Haystack passage` in the **Sources** drawer. Select
**Show full retrieved passage** to expand the complete indexed source text,
including its document, article, paragraph marker, and line range.

The browser never receives an LLM key or Graphify credentials and never connects
directly to Graphify. Only `query_graph`, `get_node`, `get_neighbors`, and
`shortest_path` are allowlisted. Project identity and the project filesystem path
come from server configuration, never from the model.

See:

- [Architecture overview](docs/architecture/overview.md)
- [API and event contracts](docs/architecture/contracts.md)
- [Architecture decisions](docs/adr/decision-log.md)
- [Graphify adapter contract](contracts/mcp/graphify-adapter.md)
- [UI guidelines](docs/ui/ui-guidelines.md)

## Configuration modes

### Default real mode

`.env.example` selects `GRAPHIFY_RUNTIME_MODE=real` and the official MCP
adapter. Graph generation needs `OPENAI_API_KEY`. To generate answers with a
real OpenAI-compatible model, configure:

```env
LLM_ADAPTER=litellm
LLM_MODEL=your-litellm-model-name
LLM_API_BASE=https://your-openai-compatible-endpoint/v1
LLM_API_KEY=replace-me
OPENAI_API_KEY=replace-me
```

### Explicit synthetic troubleshooting mode

```bash
docker compose -f docker-compose.yml -f docker-compose.synthetic.yml up --build
```

Synthetic MCP tests do not validate compatibility with the real Graphify
runtime.

### Conversation persistence

The default single-API deployment stores conversations in SQLite under
`/knowledge/state` on the persistent `graphify_knowledge` named volume. To use
the tested PostgreSQL backend instead:

```bash
docker compose -f docker-compose.yml -f compose/postgres.yml up --build
```

Only the current conversation UUID is kept in browser `localStorage`. Previous
turn text is bounded and sanitized before it is supplied to follow-up
resolution. It is never accepted as knowledge evidence: citations must match
graph or bounded source evidence retrieved for the current request.

### Source-text index

Knowledge ingestion parses Markdown into article-aware paragraph and list
passages while preserving the original UTF-8 text, filename, article and
paragraph markers, line range, document checksum, and graph version. The
default location is:

```env
KNOWLEDGE_SOURCE_INDEX_PATH=/knowledge/state/source-index.sqlite
```

Passages for multiple graph versions can coexist in SQLite. The active manifest
version selects the matching graph and source rows, so staging or a failed index
rebuild does not replace the previously active evidence. Unchanged input
checksums continue to use the existing ingestion skip path. A rollback selects
the prior graph version and its corresponding source passages.

SQLite uses FTS5 with Unicode diacritic handling, allowing accented and
unaccented Spanish queries without an embedding model, vector database,
Elasticsearch, or OpenSearch.

Never commit `.env`, provider keys, proprietary source material, or proprietary
Graphify projects. Do not prefix secrets with `NEXT_PUBLIC_`.

## Developer commands

```bash
make setup          # create .env if absent, build images
make dev            # docker compose up --build
make up-postgres    # use the optional PostgreSQL conversation backend
make test           # backend and frontend tests in image build stages
make lint           # Ruff/format/mypy and ESLint/TypeScript checks
make e2e            # explicit synthetic stack plus Playwright suite
make compose-check  # validate the Compose model
make compose-check-postgres
make smoke          # check web, API health, and API readiness
make knowledge-ingest
make knowledge-status
make knowledge-rebuild
make knowledge-rollback
make test-graphify-real
make smoke-spanish
make logs           # follow service logs
make down           # stop services
make clean          # stop services and remove the named knowledge volume
```

`make e2e` installs Playwright dependencies on the host and therefore requires
Node/npm in addition to Docker. See [Getting started](docs/getting-started.md)
for direct test commands.

## Scope and limitations

- Authentication and authorization are intentionally absent.
- Conversations expire after 30 days and retain at most 100 complete exchanges
  by default; both limits are configurable.
- The browser stores only the current conversation ID in `localStorage`.
- There is no account-level conversation list or cross-device synchronization.
- Conversation IDs are bearer capabilities in this unauthenticated POC.
- One server-configured Graphify project is supported per deployment.
- Source-text retrieval is lexical BM25; no semantic embedding retriever is
  configured.
- Article-detail answers require both a Graphify article scope and matching
  source passages.
- If Haystack is unavailable, sufficiently supported graph-only relationship
  questions may continue, but article-detail questions return insufficient
  evidence.
- The synthetic troubleshooting profile is not Graphify and cannot establish
  compatibility with Graphify 0.9.18.
- The deterministic model proves integration behavior, not answer quality.
- Readiness verifies the active graph and initializes an official MCP session to
  validate the allowlisted tool schemas. It reports model configuration without
  making a billable LLM request.
- Generated answers are a technical demonstration, not legal advice.
- OpenTelemetry instrumentation is enabled where the installed instrumentation
  supports it, but no collector/export pipeline is included.
- This is a local POC, not a hardened multi-user or production deployment.

For common failures, see [Troubleshooting](docs/troubleshooting.md).
