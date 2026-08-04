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

Set `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` and
`KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD` to local-only bootstrap values. They create
the Keycloak administrative account only; no application users are bundled.

The default mode is the real open-source `graphifyy==0.9.18` runtime. On a
fresh volume, editors upload a project snapshot through the UI and explicitly
start its build. With the configured `openai` extraction backend, set
`OPENAI_API_KEY`; `OPENAI_BASE_URL`, `OPENAI_MODEL`, and
`GRAPHIFY_EXTRACT_MODEL` are optional provider overrides.

Start the real stack:

```bash
docker compose up --build
```

Startup order is:

```text
knowledge-init -> graphify + keycloak -> api -> knowledge-worker + web
```

Ingestion failure stops the dependency chain and preserves an existing active
graph. It never starts the synthetic runtime as a fallback.

When healthy:

- UI: <http://localhost:3000>
- API: <http://localhost:8000>
- OpenAPI: <http://localhost:8000/docs>
- Keycloak: <http://localhost:8080>

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

## Project workflow

Create disposable development users in Keycloak and assign the `viewer`,
`editor`, or `admin` realm role. Sign in at the UI. Editors can create a project,
upload supported files, and select **Build project**. Viewers can start a
conversation only after a validated version is active.

The host `knowledge/input` directory and legacy commands remain available only
through the `legacy-single-project` Compose profile. Normal project bytes,
graphs, and source indexes are stored below `/knowledge/projects` in the named
volume.

## Legacy knowledge operations

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

The development knowledge administration routes require the `admin` realm role.

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
