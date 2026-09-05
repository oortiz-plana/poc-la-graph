# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

An `AGENTS.md` also exists at the repo root with the same audience and authority as this
file — read it too. It carries the full non-negotiable invariants, coding conventions, and
workflow rules; this file summarizes the architecture and commands so you can get moving
quickly, and cross-references AGENTS.md rather than repeating it.

## Project purpose

Local proof of concept for evidence-grounded chat over legal (Spanish-language) and other
documents, plus an additive authenticated `/plsql` developer console for read-only PL/SQL
dependency and impact analysis. Stack:

- Graphify `0.9.18` — authoritative entity/relationship graph (official MCP runtime).
- Haystack `2.31.0` over a durable SQLite FTS5 source-text index — scoped BM25 passage ranking.
- `apps/api`: FastAPI, LangGraph, LiteLLM, Pydantic, SQLAlchemy (Python 3.12).
- `apps/web`: Next.js 15, React 19, TypeScript, Tailwind, Radix/shadcn, Vercel AI SDK.
- Keycloak for auth (Authorization Code + PKCE S256); Docker Compose for local runtime.

## Commands

All canonical checks run containerized via `make`; use the focused local commands only when a
matching local environment (`apps/api` venv, `apps/web` node_modules) is already installed.

```bash
make setup              # create .env if absent, build images
make dev                # docker compose up --build (real Graphify + ingestion)
make up-postgres        # swap in the tested PostgreSQL conversation backend
make test               # test-api + test-web, containerized
make lint               # Ruff/mypy (api) + ESLint/TypeScript (web), containerized
make e2e                # synthetic stack + Playwright (specs/chat.spec.ts, specs/plsql-analysis.spec.ts)
make compose-check      # validate the Compose model
make smoke              # web/API health + readiness
make knowledge-status / knowledge-ingest / knowledge-rebuild / knowledge-rollback
make test-graphify-real # checks the installed Graphify package contract
make smoke-spanish      # requires a healthy real stack + configured provider
make logs / down
make clean              # DESTRUCTIVE: removes the persistent knowledge volume — only on explicit request
```

Synthetic (deterministic) stack, used by `make e2e` and for local PL/SQL console dev:

```bash
docker compose -f docker-compose.yml -f docker-compose.synthetic.yml up --build
```

### Backend (`apps/api`), local environment

```bash
cd apps/api
ruff format app tests
ruff check app tests
mypy app
pytest -q -p no:cacheprovider tests/path/to/test_file.py   # single test file
pytest -q -p no:cacheprovider tests/plsql -k test_name      # single test by name
```

### Frontend (`apps/web`), local environment

```bash
cd apps/web
npm test -- --run src/path/to/component.test.tsx   # vitest, single file
npm run typecheck
npx prettier --check src/path/to/file.tsx
npm run build
```

### E2E (`tests/e2e`)

```bash
cd tests/e2e && npm ci && npx playwright install --with-deps chromium
npm test              # chat + plsql-analysis specs against the synthetic stack
npm run test:plsql    # plsql-analysis.spec.ts only
npm run test:recovery # E2E_DEPENDENCY_CONTROL=1, resilience.spec.ts
npm run test:spanish  # E2E_REAL_GRAPHIFY=1, requires a real configured stack
```

`make e2e` requires Node/npm on the host in addition to Docker (it installs Playwright there).

## Architecture

### Chat / knowledge-grounded query path

```
Browser --(PKCE)--> Keycloak
Browser --same-origin--> Next.js route handlers (apps/web/src/app/api)
  --Bearer/JSON/SSE--> FastAPI (apps/api/app/api)
    --> conversation store (app/store, SQLAlchemy)
    --> bounded LangGraph workflow (app/agent)
          --> GraphKnowledgeClient (app/integrations/graphify) --> Graphify MCP
          --> Haystack source retriever (app/integrations/haystack), scoped by Graphify's allowlist
          --> LanguageModel / LiteLLM adapter (app/integrations/llm) --> configured provider
```

Graph-first grounded retrieval is the core invariant: Graphify runs first and determines the
allowed documents/articles; Haystack ranks exact source passages within that scope and can
only narrow it, never broaden it. Relationship claims need graph evidence; textual/legal
claims need exact source-passage evidence with document/article/paragraph/line metadata.
Insufficient evidence must produce an explicit insufficient-evidence response rather than an
inferred answer. See the full invariant list in `AGENTS.md` (grounding/retrieval, provider/MCP
boundaries, knowledge ingestion, public contracts/streaming) before touching any of these
boundaries — it also lists what requires an ADR.

Knowledge ingestion (`apps/api/app/knowledge`, `apps/api/app/projects`) is a separate
control plane from chat's query plane: uploads seal into immutable content-addressed
snapshots, a durable single-concurrency worker builds a native Graphify graph plus a
version-local SQLite FTS5 source index, and activation is atomic — a failed build never
replaces the active version.

### PL/SQL analysis console (`/plsql`, ADR 0011–0015)

An additive, disabled-by-default developer tool: deterministic read-only PL/SQL object
search, callers/callees/table-access with typed relationships, bounded dependency paths,
unresolved references, an evidence-linked read-only source viewer, and a bounded impact
report. It is explicitly **not** a graph editor, and MCP is out of scope for it (unlike the
chat path). The analysis engine and Neo4j sync live in a sibling `plsqlgraph` repo; this repo
only ships the gateway (`apps/api/app/api/routes/plsql`, `apps/api/app/integrations/plsql`)
and the console UI (`apps/web/src/app/plsql`, `apps/web/src/components/plsql-analysis`).

- `PLSQL_ADAPTER`: `disabled` (default) | `synthetic` (deterministic fixture corpus,
  `app/integrations/plsql/synthetic.py` + `fixtures.py`) | `neo4j` (official `neo4j` 5.x
  driver, read-only sessions + allowlisted catalog in `app/integrations/plsql/catalog.py` +
  `neo4j_client.py`; ADR 0012 §0.1 resolved — real-graph schema alignment still pending a
  live `plsqlgraph` instance).
- Enable locally with `PLSQL_ADAPTER=synthetic`, `PLSQL_PROJECT_ID=sample`,
  `PLSQL_SOURCE_ROOT=/app/plsql-fixtures/source` on the API and `PLSQL_ENABLED=true` on the
  web, or just run the synthetic Compose overlay above.
- Opaque object IDs embed `/` (`plsql://…`), so identifier endpoints take query parameters,
  not path segments (ADR 0013).
- Design/vocabulary: `docs/architecture/plsql-analysis-console.md`. Contract:
  `docs/architecture/contracts.md`. Status/phase tracking:
  `docs/plsql-analysis/implementation-plan.md`. Read the implementation-plan status table
  before assuming a phase is unimplemented.

### Repository map

| Path | Responsibility |
| --- | --- |
| `apps/api/app/api` | FastAPI route composition, auth dependencies, public HTTP/SSE boundaries, request correlation, normalized errors. |
| `apps/api/app/agent` | Bounded LangGraph orchestration: follow-up resolution, graph retrieval, source scoping, answer generation, citation validation, terminal SSE events. |
| `apps/api/app/integrations/graphify` | The only code that understands native Graphify MCP payloads (4 allowlisted ops: `query_graph`, `get_node`, `get_neighbors`, `shortest_path`). |
| `apps/api/app/integrations/haystack` | Scoped source-text ranking and bounded parent reconstruction. |
| `apps/api/app/integrations/llm` | Provider-neutral model boundary + LiteLLM adapter. |
| `apps/api/app/integrations/plsql` | PL/SQL analysis gateway adapters (`client.py` protocol, `synthetic.py`, `catalog.py`, `neo4j_client.py`, `source.py`). |
| `apps/api/app/knowledge`, `app/projects` | Secure discovery, conversion, deterministic chunking, indexing, versioning, activation, rollback; project/upload/build persistence and the durable worker. |
| `apps/api/app/store` | Conversation repository protocol + SQLAlchemy implementations, subject-private histories. |
| `apps/web/src/app` | Next.js routes incl. same-origin proxies; chat route translates backend SSE into the Vercel AI SDK data stream; `plsql`, `projects`, `governance` sections. |
| `apps/web/src/components` | Chat, evidence, citations, project workspace UI; `plsql-analysis/` for the console. |
| `apps/web/src/lib/contracts.ts`, `api.ts` | Zod-validated runtime contract for every backend payload the UI renders; typed API client. |
| `contracts/` | Frozen OpenAPI, SSE, answer/evidence, MCP adapter, and PL/SQL JSON schemas shared across boundaries. |
| `docs/adr` | Architecture decisions — add one for a breaking contract or architectural change. |
| `tests/e2e` | Playwright synthetic, recovery, and real-Spanish suites. |

Start with `README.md`, then the relevant doc under `docs/` before changing a boundary.
Prefer executable contracts, current code, and tests over older narrative docs when they
disagree.

### Architectural patterns worth knowing before editing

- **Backend for frontend**: only Next.js route handlers talk to FastAPI; the browser never
  calls it directly.
- **Ports and adapters**: workflow code depends on internal graph/retrieval/model/persistence
  interfaces; Graphify MCP, Haystack, LiteLLM, SQLite/PostgreSQL specifics stay in adapters.
- **Control-plane/query-plane separation**: ingestion is a durable writer worker; chat
  retrieval is request-bound, version-pinned, and read-only.
- **Immutable snapshots, atomic activation**: builds publish a new version; activation
  requires both the graph artifact and matching source index to validate.
- **Typed streaming lifecycle**: every SSE request ends in exactly one `message.completed` or
  `message.failed`; a tool start precedes its matching completion; no raw provider payloads or
  hidden reasoning leak to the browser.

## Configuration

Key env vars (see `.env.example` for the full set): `TENANCY_MODE` (`fixed` | `claim`),
`TENANT_ID`/`TENANT_IDS`, `AUTH_TENANT_CLAIM`, `AUTH_GROUPS_CLAIM`, `GRAPHIFY_RUNTIME_MODE`,
`LLM_ADAPTER` (`litellm` | `mock`), `LLM_MODEL`/`LLM_API_BASE`/`LLM_API_KEY`,
`OPENAI_API_KEY`, `KNOWLEDGE_SOURCE_INDEX_PATH`, `PLSQL_ADAPTER`/`PLSQL_PROJECT_ID`/
`PLSQL_SOURCE_ROOT`/`PLSQL_ENABLED`. Never read, print, or search `.env` contents — check by
variable name/presence only (full rule in `AGENTS.md` § Secrets and sensitive data).

## Before you edit

Read `AGENTS.md` in full for: the non-negotiable invariants (grounding/retrieval, provider/MCP
boundaries, knowledge ingestion, public contracts/streaming — most require an ADR to change),
the development workflow (reproduce with the smallest request, smallest coherent fix, add a
regression test at the layer where the defect occurred), and coding conventions for Python and
TypeScript. Contract changes must update backend models, `contracts/`, browser
validation/types, tests, and docs together in the same change.
