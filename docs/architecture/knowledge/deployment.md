# Real Graphify deployment contract

## Default container boundary

The default Compose stack builds the real open-source runtime from
`docker/graphify.Dockerfile` with:

```text
graphifyy[mcp]==0.9.18
mcp==1.29.0
```

The separate API/ingestion image installs the `openai` extraction extra because
it runs `graphify extract`; the query-only Graphify runtime does not carry that
provider dependency.

It starts the verified entry point:

```bash
graphify-mcp \
  --graph /knowledge/graph/active/graph.json \
  --transport http \
  --host 0.0.0.0 \
  --port 8001 \
  --path /mcp \
  --stateless
```

Normal startup is simply:

```bash
docker compose up --build
```

The runtime volume is mounted read-only into Graphify. Only the ingestion/API
container can stage and publish new versions. The browser has no Graphify
network route or credentials.

## Persistent layout

```text
/knowledge/
  input/                       read-only host bind
  staging/<ingestion-id>/
  graph/
    versions/<graph-version>/
      graph.json
      build.json
    active -> versions/<graph-version>
  failed/<ingestion-id>/
  archive/
  state/
    manifest.json
    manifest.lock
```

Publication writes a complete immutable directory, validates and syncs it,
renames it into `versions`, and atomically replaces the relative `active`
symlink. The manifest records current and previous versions. At least one
previous version is retained for rollback.

## Reload and readiness

Graphify 0.9.18 checks the active graph file's modification time and size in
tool handlers and reloads a changed graph. Atomic symlink activation therefore
keeps the old graph usable during generation and makes the next valid version
visible without an in-place overwrite.

The container health check initializes an official MCP session and confirms
`query_graph`, `get_node`, `get_neighbors`, and `shortest_path`. API `/ready`
also validates the configured schemas and reports graph, MCP, and model state
separately. It does not make a billable model request.

The explicit synthetic overlay is a troubleshooting/test double only:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.synthetic.yml \
  up --build
```

It is never selected after a real ingestion or runtime failure.
