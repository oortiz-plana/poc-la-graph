# Knowledge ingestion

Each successful graph build also parses the original UTF-8 Markdown into
article- and paragraph-aware passages and commits them to the versioned SQLite
FTS5 index at `KNOWLEDGE_SOURCE_INDEX_PATH`. Rows carry the graph version and
document checksum. The manifest's active graph version selects both graph and
text evidence, so a staged rebuild or failed source-index transaction leaves
the previous graph/text pair available.

The default stack uses the open-source `graphifyy==0.9.18` package and its
native `graph.json` runtime. The four Spanish Markdown inputs live in
`knowledge/input/`; their bytes are not rewritten.

## Lifecycle

`knowledge-ingest` discovers regular `.md` files without following symlinks,
validates UTF-8 and configured size/count limits, calculates SHA-256 checksums,
and creates an immutable staging copy. It invokes:

```bash
graphify extract /knowledge/staging/<id>/source \
  --backend openai \
  --out /knowledge/staging/<id>/output \
  --no-cluster
```

Graphify writes
`output/graphify-out/graph.json`. The service validates a non-empty native
node/edge artifact, publishes it at
`/knowledge/graph/versions/<id>/graph.json`, then atomically replaces the
`/knowledge/graph/active` symlink. The manifest is atomically persisted at
`/knowledge/state/manifest.json`. At least two versions are retained.

A failed build is moved to `/knowledge/failed/<id>` and leaves the active
graph untouched. A POSIX `flock` prevents concurrent builds.
`/knowledge/archive` is reserved for a future retention job; the POC does not
silently move or delete source documents after ingestion.

Graphify's Markdown extraction is semantic and requires a working provider
credential. For the OpenAI backend set `OPENAI_API_KEY` and optionally
`OPENAI_MODEL`/`OPENAI_BASE_URL`. Failure is explicit; there is no synthetic
fallback.

## Commands

```bash
make knowledge-ingest
make knowledge-rebuild
make knowledge-status
make test-graphify-real
make smoke-spanish
```

The unauthenticated `POST /api/v1/knowledge/ingestions` endpoint is strictly a
development POC operation and disappears when
`KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED=false`.

## Future upload boundary

Build orchestration depends on `KnowledgeDocumentSource`; the current
implementation is filesystem-only. A future authenticated source must enforce
`knowledge:document:upload`, `knowledge:ingestion:execute`,
`knowledge:ingestion:read`, and `knowledge:graph:activate`. No upload endpoint
or upload UI exists in this POC.

Synthetic MCP tests do not validate compatibility with the real Graphify
runtime.
