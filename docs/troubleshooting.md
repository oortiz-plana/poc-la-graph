# Troubleshooting

Start with:

```bash
docker compose ps
docker compose logs --tail=200 graphify api web
docker compose config --quiet
```

API logs are structured JSON and include request IDs. The same request ID is
returned in `X-Request-ID`; use it to correlate a browser/API failure without
logging credentials or retrieved evidence.

## An image does not build

The first build requires registry and package-index access. Confirm Docker has
network access and enough disk space, then build the failing service:

```bash
docker compose build graphify
docker compose build api
docker compose build web
```

Do not interpret a successful image build as a successful runtime or test unless
the relevant command was also executed.

## Graphify is unhealthy or unavailable

Inspect its logs and test the internal port from the API container:

```bash
docker compose logs graphify
docker compose exec api python -c \
  "import socket; socket.create_connection(('graphify', 8001), 3).close()"
```

For the default real stack, confirm:

```env
GRAPHIFY_RUNTIME_MODE=real
GRAPHIFY_ADAPTER=mcp
GRAPHIFY_PROJECT_PATH=/knowledge/graph/active
```

`make knowledge-status` must report a valid active version. The Graphify service
uses `/knowledge/graph/active/graph.json` and the official
`graphify-mcp --transport http` entry point. Its health check initializes an MCP
session and verifies the four required tools rather than checking only a TCP
port.

For explicit synthetic troubleshooting, use both Compose files. That overlay
sets `GRAPHIFY_RUNTIME=mock` and `GRAPHIFY_RUNTIME_MODE=synthetic`; setting only
one of them is insufficient:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.synthetic.yml \
  up --build
```

A reachable TCP port is only a preliminary check. Use an MCP Inspector or
official SDK client to initialize a session and list tools. A raw HTTP GET does
not validate streamable HTTP MCP.

## Knowledge ingestion exits before Graphify starts

`knowledge-init` is a one-shot permissions/setup container, so
`knowledge-init exited with code 0` is expected. The `knowledge-ingest` container
must also finish successfully before the real Graphify MCP service can start.

Inspect the structured failure code:

```bash
docker compose logs --no-color knowledge-ingest
```

`graphify_provider_authentication_failed` means the OpenAI-compatible provider
used by Graphify's semantic extraction rejected its credential. Graphify itself
does not require a license key. Create the local environment file and set the
extraction-provider variables there:

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=replace-with-a-valid-provider-key
# Set these when using a compatible provider rather than OpenAI:
OPENAI_BASE_URL=https://provider.example/v1
OPENAI_MODEL=provider-model-name
```

Do not put this credential in `NEXT_PUBLIC_*`, commit `.env`, or paste it into
logs. `OPENAI_*` configures graph extraction; `LLM_*` independently configures
answer generation through LiteLLM. After correcting the provider settings,
recreate the one-shot pipeline:

```bash
docker compose down --remove-orphans
docker compose up --build
```

Other sanitized ingestion codes distinguish missing credentials, rate limits,
unknown models/endpoints, invalid base URLs, timeouts, and connection failures.
Raw provider responses are not logged. A failed build leaves the active graph
unchanged; if there was no prior valid graph, `make knowledge-status` reports
`unavailable`.

## The API fails during startup

View:

```bash
docker compose logs api
```

Common configuration failures:

- `LLM_ADAPTER=litellm` with an empty `LLM_MODEL`.
- A `GRAPHIFY_PROJECT_PATH` outside `GRAPHIFY_KNOWLEDGE_ROOT`.
- A malformed Graphify MCP URL or unsupported transport.
- Invalid numeric limits outside the ranges enforced by Pydantic settings.

The application never silently switches to deterministic adapters. To
troubleshoot without a provider, explicitly set `LLM_ADAPTER=mock`. The default
Compose stack should still use `GRAPHIFY_ADAPTER=mcp` so it exercises MCP.

## `/health` works but `/ready` does not

`/health` is process liveness. `/ready` reports the active graph, initializes an
official MCP session, and validates required tool schemas. It reports whether
the LLM is configured or mocked but does not make a live LLM request, so a
temporary model-provider outage does not by itself make readiness fail.

Inspect API startup logs. If settings changed, recreate the container:

```bash
docker compose up -d --build --force-recreate api
```

## The UI says the API is unavailable

Check both endpoints from the host:

```bash
curl --fail http://localhost:8000/health
curl --fail http://localhost:3000
```

Inside Compose, Next.js reaches FastAPI at `http://api:8000`; the browser uses
same-origin `/api/*` routes and never receives an internal service URL. If the
Compose service name changes, update `API_INTERNAL_URL` and recreate the web
container. Configure CORS only for deliberate direct API clients.

The UI retries its health check periodically. Use **Check connection** for an
immediate retry.

## A conversation expired

Conversation data is process-local memory. An API restart, rebuild, or replica
change loses it while the old ID may remain in browser `sessionStorage`. Reload
the page; the UI should detect a missing conversation and create a new one. If
needed, clear the site's session storage and reload.

This limitation is intentional for the POC. No database or shared cache is
configured.

## The project ID is rejected

The API accepts only its server-configured `GRAPHIFY_PROJECT_ID`. Ensure the
Graphify container, API, and browser-visible project indicator use the same
project ID, then rebuild the web image and recreate the services. This POC
supports one project per deployment.

Never solve this by accepting a project path from a request or model output.

## MCP reports missing tools

The API requires all four configured allowlisted tool names:

```env
GRAPHIFY_SEARCH_TOOL=query_graph
GRAPHIFY_GET_NODE_TOOL=get_node
GRAPHIFY_GET_NEIGHBORS_TOOL=get_neighbors
GRAPHIFY_SHORTEST_PATH_TOOL=shortest_path
```

Use the Graphify server's `tools/list` response to map its native names. The
adapter rejects incomplete, duplicate, or non-allowlisted mappings.

## The answer reports insufficient evidence

This is an expected grounded outcome, not necessarily a service error. It occurs
when retrieval returns no usable evidence, citations are absent, or the model
references citation IDs not present in the retrieved evidence.

Try a question whose terminology appears in the configured project. For the
synthetic project, ask about the web application, Knowledge Agent API, Graphify,
streaming, or MCP. Inspect the Sources/Evidence drawer and Graphify logs.

Do not weaken citation validation to force an answer.

## A message stream fails or stops

The backend emits named SSE events and Next.js validates and translates them to
the Vercel AI SDK stream. Failures can come from Graphify unavailability, MCP or
overall timeouts, an unavailable model, invalid structured model output,
malformed MCP output, configured limits, or an interrupted client connection.

Correlate the request's `X-Request-ID` with API logs. Review:

```env
GRAPHIFY_REQUEST_TIMEOUT_SECONDS=20
LLM_REQUEST_TIMEOUT_SECONDS=45
AGENT_REQUEST_TIMEOUT_SECONDS=60
```

The overall timeout must leave room for the intended Graphify and model work.
Increasing limits can increase latency and resource use. Retry only after the
underlying dependency has recovered.

## LiteLLM/provider failures

Confirm the API container received server-side configuration without printing
the secret:

```bash
docker compose exec api python -c \
  "import os; print(os.getenv('LLM_ADAPTER'), os.getenv('LLM_MODEL'), bool(os.getenv('LLM_API_KEY')))"
```

Verify `LLM_MODEL` follows LiteLLM naming for the provider and that
`LLM_API_BASE` is the correct OpenAI-compatible base URL. Provider errors are
sanitized before they reach the browser, so consult provider-side observability
and API logs for timing while keeping credentials out of logs.

## Port conflicts

Another process may already own ports 3000 or 8000. Identify and stop that
process, or change the published port in a local Compose override. If the web
origin changes, update CORS and public URL configuration too.

## The PL/SQL console is missing, not configured, or unavailable

The console is a separate developer tool under `/plsql`; it does not affect the
chat surface. Start from the two switches that gate it:

```env
# api service
PLSQL_ADAPTER=synthetic        # disabled (default) | synthetic | neo4j (fails fast)
PLSQL_PROJECT_ID=sample
PLSQL_SOURCE_ROOT=/app/plsql-fixtures/source
# web service
PLSQL_ENABLED=true
```

Check `GET /ready` → `components.analysis.status` to tell the four states apart
(`disabled | synthetic | connected | unavailable`):

- **No “PL/SQL analysis” entry in the navigation** — the web service did not
  start with `PLSQL_ENABLED=true` (never a `NEXT_PUBLIC_*` variable). Restart
  the web container with the variable set.
- **“Analysis is not configured”** in the console — the API has no analysis
  client on `request.app.state`: `PLSQL_ADAPTER` is `disabled`, or the settings
  did not reach the API. The API answers every `/api/v1/plsql/*` route with
  `503 analysis_not_configured`; check inside the container that the variable is
  present (without printing values):
  `docker compose exec api sh -c 'test -n "$PLSQL_ADAPTER" && echo set'`.
- **“Analysis is unavailable” / `503 analysis_unavailable`** — the adapter is
  configured but the connectivity check failed. In synthetic mode this is
  unexpected: verify the API reached startup and the fixture corpus is mounted.
- **Source viewer errors (`404 analysis_not_found`) on known objects** —
  `PLSQL_SOURCE_ROOT` is unset or does not point at the mounted corpus. The
  overlay mounts `apps/api/tests/fixtures/plsql` read-only at
  `/app/plsql-fixtures` and sets `PLSQL_SOURCE_ROOT` to its `source/` child.
- **`503 analysis_limit_exceeded` while viewing a file** — the file exceeds
  `PLSQL_MAX_SOURCE_BYTES` (default 262144). This is a per-file cap, not a
  corruption.

Error text never exposes filesystem paths, provider credentials, or raw graph
payloads; correlation uses `X-Request-ID` as elsewhere.

## Reset the environment

First use the non-destructive stop:

```bash
make down
```

To remove containers and the named knowledge volume:

```bash
make clean
```

`make clean` removes the Compose volumes for this project. Host-mounted Graphify
projects are not deleted.
