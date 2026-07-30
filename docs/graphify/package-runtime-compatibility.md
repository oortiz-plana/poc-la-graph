# Graphify Package and Runtime Compatibility Evidence

Research date: 2026-07-28  
Package inspected: `graphifyy==0.9.18`  
Source corpus requested for the eventual graph:
`/home/oortiz/oao/poc-la-20250512/web-to-markdown/data/laws`

## Finding

The real runtime must pin both packages:

```text
graphifyy[mcp]==0.9.18
mcp==1.29.0
```

Do not install the `mcp` extra without the second constraint. In the package
index state inspected on 2026-07-28, the unbounded `mcp` dependency resolved to
`mcp==2.0.0`. Graphify 0.9.18 then failed before serving because its
`graphify.serve` module imports `AnyUrl` from `mcp.types`, where MCP 2.0.0 no
longer exports it.

Graphify should remain in its own container. This avoids coupling its dependency
set to the Agent API's official MCP client and makes its native text contract
explicit.

The Agent API adapter was updated and has been exercised against the native
Graphify 0.9.18 server. Compatibility work required these native differences:

- Native search tool name: `query_graph`, not `search`.
- Native tools return `TextContent` with human-readable text, not the normalized
  JSON object the adapter currently requires.
- Native argument names differ. The adapter validates the four required input
  schemas before issuing a tool call.
- The server is started with one trusted active `graph.json`; the adapter never
  accepts an LLM- or browser-supplied `project_path`.
- The native server exposes ten tools, so the application must continue to
  allowlist only the four retrieval tools it needs.

The adapter parses native text only inside the Graphify integration boundary,
normalizes it into typed domain models, and maps stable opaque application IDs
back to Graphify labels for follow-up calls. A live contract probe using the
official MCP SDK discovered and invoked `query_graph`, `get_node`,
`get_neighbors`, and `shortest_path` against a minimal native-format graph.
That probe validates runtime compatibility; it does not claim that the Spanish
legal corpus was successfully extracted.

## Package metadata evidence

Installation was isolated in `/tmp/graphify-research-venv`:

```bash
python3 -m venv /tmp/graphify-research-venv
/tmp/graphify-research-venv/bin/pip install 'graphifyy[mcp]==0.9.18'
```

Observed:

```text
Successfully installed ... graphifyy-0.9.18 ... mcp-2.0.0 ...
```

Metadata inspection returned:

```text
version=0.9.18
requires-python=>=3.10
entry-points:
graphify=graphify.__main__:main
graphify-mcp=graphify.serve:_main
```

The wheel declares the `mcp` extra as:

```text
mcp; extra == "mcp"
starlette>=1.3.1; extra == "mcp"
```

There is no upper bound on `mcp`.

PyPI identifies the 0.9.18 wheel as MIT licensed, requiring Python 3.10 or
newer, and published on 2026-07-17. The official project documentation also
identifies the distribution name as `graphifyy` (two `y` characters) and its
command as `graphify`.

Primary references:

- <https://pypi.org/project/graphifyy/0.9.18/>
- <https://graphify.com/mcp>
- <https://github.com/safishamsi/graphify>

## CLI evidence

`graphify --help` in 0.9.18 exposes, among others:

```text
graphify extract <path>       headless AST + semantic extraction
graphify query "<question>"   BFS traversal
graphify path "A" "B"         shortest path
graphify explain "X"          node explanation
graphify cluster-only <path>  clustering/report generation
```

Relevant extraction options are:

```text
--backend B             gemini|kimi|claude|openai|deepseek|ollama
--model M               provider model override
--mode deep             aggressive INFERRED-edge extraction
--force                 bypass incremental manifest/cache
--max-workers N         AST extraction workers
--token-budget N        per semantic chunk, default 60000
--max-concurrency N     semantic requests in flight, default 4
--api-timeout S         per LLM request, default 600
--out DIR               writes <DIR>/graphify-out/
--no-cluster            raw extraction only
--code-only             skip documents and other semantic inputs
```

The requested laws corpus contains four Markdown inputs:

```text
ley-2381-de-2024.md
ley-100-de-1993.md
resoluci-n-1271-de-2023.md
ley-797-de-2003.md
```

Markdown is semantic document input, so `--code-only` must not be used.
Graphify's own privacy documentation says documents require an LLM backend.
No generation run against the laws corpus was claimed during this inspection.

Verified extraction command used by the ingestion service, with immutable
staging input and output written elsewhere:

```bash
graphify extract \
  /knowledge-source/laws \
  --backend openai \
  --model "$OPENAI_MODEL" \
  --out /knowledge/laws-project \
  --no-cluster
```

For an OpenAI-compatible endpoint Graphify 0.9.18 documents
`OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY`. This is Graphify's
generation-time provider configuration and is separate from the Agent API's
`LLM_*` runtime settings.

The produced artifact path is:

```text
/knowledge/laws-project/graphify-out/graph.json
```

As a local deterministic CLI sanity check, the inspected package successfully
ran code-only extraction over `apps/api/app`:

```text
[graphify extract] found 31 code, 0 docs, 0 papers, 0 images
[graphify extract] wrote .../graphify-out/graph.json — 264 nodes, 805 edges
```

## MCP HTTP command and configuration

`python -m graphify.serve --help` returned:

```text
usage: python -m graphify.serve [-h] [--graph PATH]
  [--transport {stdio,http}] [--host HOST] [--port PORT]
  [--api-key API_KEY] [--path PATH] [--json-response]
  [--stateless] [--session-timeout SESSION_TIMEOUT] [graph_path]
```

Defaults:

- transport: `stdio`
- host: `127.0.0.1`
- port: `8080`
- HTTP path: `/mcp`
- stateful sessions with a 3600-second idle timeout

Verified container command:

```bash
graphify-mcp \
  --graph /knowledge/graph/active/graph.json \
  --transport http \
  --host 0.0.0.0 \
  --port 8001 \
  --path /mcp \
  --stateless
```

`--json-response` changes the Streamable HTTP transport framing response from
SSE to JSON; it does **not** change native tool results from text into the
application's normalized graph-evidence JSON.

`--api-key` (or `GRAPHIFY_API_KEY`) enables HTTP transport authentication.
Authentication remains out of scope for this POC, but should be used with
private secret injection for a production network.

### Startup evidence

With the unconstrained extra:

```text
ImportError: cannot import name 'AnyUrl' from 'mcp.types'
...
ImportError: mcp not installed. Run: pip install "graphifyy[mcp]"
```

The message is misleading: MCP was installed, but version 2.0.0 was
incompatible. Installing `mcp==1.29.0` resolved that import/API incompatibility.
The pinned server subsequently started over Streamable HTTP and the production
adapter successfully normalized all four allowlisted operations against a
minimal native-format graph.

## Exact native 0.9.18 tool schemas

Graphify 0.9.18 constructs these schemas in `graphify/serve.py`. Every tool also
receives this optional property:

```json
{
  "project_path": {
    "type": "string",
    "description": "Absolute path to a project directory containing graphify-out/graph.json. Optional — defaults to the graph this server was started with."
  }
}
```

The four POC-relevant tools are:

### `query_graph`

```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "Natural language question or keyword search"
    },
    "mode": {
      "type": "string",
      "enum": ["bfs", "dfs"],
      "default": "bfs"
    },
    "depth": {
      "type": "integer",
      "default": 3,
      "description": "Traversal depth (1-6)"
    },
    "token_budget": {
      "type": "integer",
      "default": 2000,
      "description": "Max output tokens"
    },
    "context_filter": {
      "type": "array",
      "items": {"type": "string"}
    },
    "project_path": {"type": "string"}
  },
  "required": ["question"]
}
```

The native result is plain text generated by Graphify's BFS/DFS formatter. It
contains node and edge context lines within the token budget, not a JSON graph.

### `get_node`

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "description": "Node label or ID to look up"
    },
    "project_path": {"type": "string"}
  },
  "required": ["label"]
}
```

Native text shape:

```text
Node: <label>
  ID: <id>
  Source: <source_file> <source_location>
  Type: <file_type>
  Community: <community>
  Degree: <number>
```

### `get_neighbors`

```json
{
  "type": "object",
  "properties": {
    "label": {"type": "string"},
    "relation_filter": {
      "type": "string",
      "description": "Optional: filter by relation type"
    },
    "project_path": {"type": "string"}
  },
  "required": ["label"]
}
```

Native text shape:

```text
Neighbors of <label>:
  --> <neighbor> [<relation>] [<confidence>]
  <-- <neighbor> [<relation>] [<confidence>]
```

There is no `depth` argument in this tool. Expansion beyond direct neighbors
must use repeated bounded calls or `query_graph` depth.

### `shortest_path`

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "description": "Source concept label or keyword"
    },
    "target": {
      "type": "string",
      "description": "Target concept label or keyword"
    },
    "max_hops": {
      "type": "integer",
      "default": 8,
      "description": "Maximum hops to consider"
    },
    "project_path": {"type": "string"}
  },
  "required": ["source", "target"]
}
```

Native text shape:

```text
Shortest path (<n> hops):
  <source> --<relation> [<confidence>]--> <target>
```

Graphify may prefix ambiguity warnings or return a plain-text no-match/no-path
message.

## Other exposed tools

The same `tools/list` construction includes:

```text
get_community
god_nodes
graph_stats
list_prs
get_pr_impact
triage_prs
```

These must not be made available to the LLM in this POC.

## Required adapter mapping

| Internal operation | Native 0.9.18 tool | Native arguments |
| --- | --- | --- |
| `search(query)` | `query_graph` | `question`, bounded `depth`, bounded `token_budget` |
| `get_node(node_id)` | `get_node` | `label` |
| `get_neighbors(node_id, depth)` | `get_neighbors` | `label`, optional `relation_filter`; direct only |
| `shortest_path(source, target)` | `shortest_path` | `source`, `target`, bounded `max_hops` |

The adapter now includes a bounded Graphify-0.9.18 text parser and keeps raw
native text inside the integration layer. Citations are derived only from
explicit native node/source records.

The real server is started with one trusted active graph. The adapter omits
`project_path`, so a model or caller cannot switch the server to another
filesystem project.

On 2026-07-28 the official MCP SDK connected to the built
`graphifyy==0.9.18` HTTP container, listed the four required native schemas,
ran accented, unaccented, and uppercase Spanish `query_graph` variants, and the
production adapter normalized the same two nodes successfully. This matches the
installed query engine's NFKD/diacritic-insensitive tokenization. Captures are in
`tests/fixtures/graphify-real/`. This validates runtime/tool/adapter
compatibility. The graph used for this contract probe is a minimal native
fixture, not the four-law generated corpus.
