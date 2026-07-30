# Getting started

## Prerequisites

- Docker Engine and Docker Compose v2
- A valid extraction-provider credential for a fresh real graph
- `curl` for smoke commands
- Node.js/npm only for the host-driven Playwright suite

Copy the example configuration:

```bash
cp .env.example .env
```

The default mode is the real open-source `graphifyy==0.9.18` runtime. On a
fresh volume, Graphify semantically extracts the four Spanish Markdown files
under `knowledge/input`. With the configured `openai` extraction backend, set
`OPENAI_API_KEY`; `OPENAI_BASE_URL`, `OPENAI_MODEL`, and
`GRAPHIFY_EXTRACT_MODEL` are optional provider overrides.

Start the real stack:

```bash
docker compose up --build
```

Startup order is:

```text
knowledge-init -> knowledge-ingest -> graphify -> api -> web
```

Ingestion failure stops the dependency chain and preserves an existing active
graph. It never starts the synthetic runtime as a fallback.

When healthy:

- UI: <http://localhost:3000>
- API: <http://localhost:8000>
- OpenAPI: <http://localhost:8000/docs>

Inspect component-level readiness:

```bash
curl --fail http://localhost:8000/health
curl --fail http://localhost:8000/ready
make knowledge-status
```

`/health` is process liveness. `/ready` separately reports the knowledge graph,
live MCP compatibility, and LLM configuration. It does not call the LLM.

## Real and synthetic modes

Normal startup uses the real Graphify package:

```bash
docker compose up --build
```

The deterministic troubleshooting stack is explicit:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.synthetic.yml \
  up --build
```

It disables `knowledge-ingest`, runs the synthetic MCP test double, and keeps
`GRAPHIFY_ADAPTER=mcp` so transport and application contracts remain exercised.
It is suitable for deterministic UI/E2E testing only.

Synthetic MCP tests do not validate compatibility with the real Graphify
runtime.

## Model configuration

The committed `LLM_ADAPTER=mock` gives deterministic Spanish/English answers
without an answer-provider call. It does not change Graphify ingestion or MCP
mode. To use an OpenAI-compatible answer model through LiteLLM:

```env
LLM_ADAPTER=litellm
LLM_MODEL=openai/your-model
LLM_API_BASE=https://provider.example/v1
LLM_API_KEY=replace-me
```

These values are API-only. Never put credentials in a `NEXT_PUBLIC_*` variable.

## Knowledge operations

The host input directory is `knowledge/input`; generated state is in the named
`graphify_knowledge` volume. The maintenance commands return non-zero on
failure:

```bash
make knowledge-ingest
make knowledge-status
make knowledge-rebuild
make knowledge-rollback
```

`knowledge-status` and `knowledge-rollback` use `--no-deps`, so they remain
usable when ingestion or Graphify startup has failed. The development-only
administrative routes can be removed entirely with:

```env
KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED=false
```

There is no upload route, login, or permission implementation. Future upload
sources must enforce `knowledge:document:upload`,
`knowledge:ingestion:execute`, `knowledge:ingestion:read`, and
`knowledge:graph:activate`.

## Tests

```bash
make test
make lint
make compose-check
make e2e
make test-graphify-real
make smoke-spanish
```

`make e2e` deliberately uses the explicit synthetic overlay. Real Graphify
contract tests use the installed Graphify package and a minimal native graph;
they do not claim that the four-law graph was generated. `make smoke-spanish`
requires a running real stack and validates the streamed Spanish result.

Stop without deleting graph state:

```bash
make down
```

Remove containers and the persistent named graph volume:

```bash
make clean
```

See [knowledge ingestion](knowledge-ingestion.md) and
[troubleshooting](troubleshooting.md).
