# Graphify runtime

The default Compose stack starts `graphify/mock/server.py`, a tiny synthetic
troubleshooting service built with the official MCP Python SDK. It is clearly
selected with `GRAPHIFY_RUNTIME=mock`. It is not Graphify and is not a substitute
for testing against the Graphify distribution used by your organization.

## Default synthetic runtime

The committed `sample/graph.json` contains non-proprietary architecture facts.
Compose mounts it read-only at `/knowledge/sample-project`. The server exposes
only `search`, `get_node`, `get_neighbors`, and `shortest_path` at
`http://graphify:8001/mcp`.

Start it with the full application:

```bash
cp .env.example .env
docker compose up --build
```

The API still uses its production MCP adapter and official MCP client. The mock
is an external MCP test server; there is no silent in-process adapter fallback.
The out-of-box stack also selects `LLM_ADAPTER=mock` explicitly so it can run
without a provider key. This deterministic answer model is for troubleshooting
only.

## Use a real Graphify MCP image

Set `GRAPHIFY_IMAGE`, project identity, and provider credentials in `.env`, then:

```bash
docker compose \
  -f docker-compose.yml \
  -f compose/graphify.real.yml \
  up --build
```

For real model answers set `LLM_ADAPTER=litellm`, `LLM_MODEL`, `LLM_API_BASE`,
and `LLM_API_KEY`. LiteLLM initialization fails closed when required provider
configuration is missing; it never silently switches to the deterministic model.

The overlay requires Docker Compose 2.24 or newer. Set `GRAPHIFY_COMMAND` only
when the image needs a simple command override; for commands with arguments,
copy the overlay and use YAML list syntax. Replace the permissive
`GRAPHIFY_HEALTHCHECK_CMD` with the image vendor's supported readiness command.

The image must listen on port 8001 and expose streamable HTTP MCP at `/mcp`, or
`GRAPHIFY_MCP_URL` must be changed accordingly. Mount a project beneath
`/knowledge` and keep `GRAPHIFY_PROJECT_PATH` beneath that root. Native tool
names can be mapped using the four `GRAPHIFY_*_TOOL` variables.

## Connectivity validation

After startup:

```bash
docker compose ps
docker compose logs graphify
docker compose exec api python -c \
  "import socket; socket.create_connection(('graphify', 8001), 3).close()"
```

Use an MCP Inspector or the official SDK client to initialize a session, call
`tools/list`, and invoke `search` with the configured project ID. A raw `curl`
GET is not a valid MCP connectivity test because streamable HTTP requires MCP
session negotiation.

## Point to another project

Mount the project read-only into the Graphify service, then update
`GRAPHIFY_PROJECT_ID` and `GRAPHIFY_PROJECT_PATH` together. Do not accept either
value from browser input or an LLM tool call. Preparing/generating a real project
is Graphify-distribution-specific; follow the Graphify version's ingest/index
commands before mounting its completed project directory.
