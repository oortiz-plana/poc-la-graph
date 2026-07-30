# Internal Graphify MCP Integration Contract

This is an internal boundary. MCP-native responses never leave the adapter.

## Interface

```python
class GraphKnowledgeClient(Protocol):
    async def search(self, query: str) -> GraphSearchResult: ...
    async def get_node(self, node_id: str) -> GraphNode: ...
    async def get_neighbors(
        self, node_id: str, depth: int = 1
    ) -> GraphSubgraph: ...
    async def shortest_path(
        self, source_node_id: str, target_node_id: str
    ) -> GraphPath: ...
```

The project ID and path are constructor configuration, never method inputs and
never model-generated values.

## Allowed operations

| Internal operation | MCP tool capability | Required arguments |
|---|---|---|
| `search` | graph search/query tool mapped at startup | configured project identity, query |
| `get_node` | node lookup tool mapped at startup | configured project identity, node ID |
| `get_neighbors` | neighbor traversal tool mapped at startup | configured project identity, node ID, bounded depth |
| `shortest_path` | shortest-path tool mapped at startup | configured project identity, two node IDs |

Graphify distributions may expose different native tool names. Startup maps
configured native names to these four capabilities, verifies they exist in
`list_tools`, and rejects any mapping outside the allowlist. The adapter invokes
tools only with the official MCP Python SDK over configured HTTP transport.

## Validation and limits

- `GRAPHIFY_PROJECT_ID` is a fixed configured identifier.
- `GRAPHIFY_PROJECT_PATH` is resolved from configuration and must be equal to or
  beneath the configured knowledge mount root. It is never accepted over HTTP or
  from the model.
- Query and node IDs are length-limited and cannot introduce extra MCP arguments.
- Depth is clamped/rejected above the workflow maximum (default 2).
- Tool calls default to 4 per message; nodes 100; edges 200; evidence 64 KiB.
- Every call uses `GRAPHIFY_REQUEST_TIMEOUT_SECONDS` (default 20) within the
  smaller overall request budget.
- Unknown content blocks, malformed JSON, missing required identifiers, oversized
  results, and non-allowlisted tool requests produce normalized adapter errors.
- Logs include request/correlation ID, operation, duration, and result counts but
  exclude credentials and full retrieved content.

## Normalized outputs

Normalized nodes have `id`, `label`, `type`, optional scalar `properties`,
`source`, `excerpt`, and `provenance`. Edges have `id`, `sourceNodeId`,
`targetNodeId`, `relationship`, optional scalar `properties`, and `provenance`.
Paths contain ordered node IDs and edge IDs. Search results additionally contain
`graphVersion`, citations, warnings, and truncation metadata.

All normalized objects conform to
`contracts/schemas/graph-evidence.schema.json`. Native MCP metadata is discarded
unless explicitly mapped to a normalized field.

## Errors

The adapter exposes stable categories: `unavailable`, `timeout`,
`invalid_response`, `limit_exceeded`, `configuration`, and `not_found`. The API
maps them to the public error codes in OpenAPI without exposing native exception
messages.

## Test double

The deterministic adapter implements the same protocol and loads committed
synthetic fixtures. It is selected only by explicit dependency injection or a
documented `GRAPHIFY_ADAPTER=mock` troubleshooting setting. Production/default
mode fails closed when MCP configuration or connectivity is invalid.

