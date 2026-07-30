# Real Graphify implementation verification

Date: 2026-07-29 (America/Bogota)

## Outcome

The application now defaults to the actual open-source Graphify runtime,
`graphifyy==0.9.18`, with `mcp==1.29.0`. The deterministic server is available
only through the explicit `docker-compose.synthetic.yml` overlay. There is no
license-key requirement and no silent fallback.

The live Graphify HTTP MCP server and the production adapter passed a
credential-free compatibility test against a minimal native-format graph. The
four supplied Spanish laws were discovered and passed source validation, but
their semantic extraction did not complete because the configured extraction
provider credential is invalid. No four-law `graph.json` or active graph
version exists, so a real-law Spanish end-to-end answer is not claimed.

## Confirmed package and commands

- Distribution: `graphifyy[mcp]==0.9.18`
- MCP compatibility pin: `mcp==1.29.0`
- License: MIT; Graphify requires no commercial license service.
- Verified extraction entry point:

  ```bash
  graphify extract <immutable-staging>/source \
    --backend openai \
    --out <immutable-staging>/output \
    --no-cluster
  ```

  When configured, `--model <model>` is included. The expected artifact is
  `<immutable-staging>/output/graphify-out/graph.json`.

- Verified HTTP MCP entry point:

  ```bash
  graphify-mcp \
    --graph /knowledge/graph/active/graph.json \
    --transport http \
    --host 0.0.0.0 \
    --port 8001 \
    --path /mcp \
    --stateless
  ```

The installed server exposed ten tools:
`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `get_community`,
`god_nodes`, `graph_stats`, `list_prs`, `get_pr_impact`, and `triage_prs`.
Only the first four are allowlisted by the agent.

## Implemented improvements

- Recursive Markdown discovery with hidden/temporary/unsupported-file
  filtering, UTF-8 validation, size/count limits, SHA-256 checksums, and
  deterministic new/changed/unchanged/removed change sets.
- Asynchronous `KnowledgeDocumentSource` boundary and typed future upload
  metadata without adding authentication or an upload endpoint.
- Immutable staging, process-safe lock, versioned graphs, validated atomic
  publication, active pointer, previous-version retention, rollback, atomic
  manifest, and failure quarantine.
- Fixed-argument Graphify subprocess with minimized environment, no content
  logging, isolated process group, and bounded `SIGTERM`/`SIGKILL` cleanup on
  timeout or cancellation.
- Official MCP SDK connection, startup schema checks, strict four-tool
  allowlist, bounded response normalization, opaque application IDs mapped
  back to Graphify labels, graph-version propagation, and sanitized failures.
- Spanish same-language instructions, diacritic-folded retrieval planning
  while preserving the original question, unchanged legal identifiers,
  evidence-derived relationship/path citations, and deterministic Spanish
  insufficient-evidence behavior.
- FastAPI readiness that distinguishes process, real/synthetic graph, MCP, and
  LLM state. Real mode is not ready without a valid active graph.
- Genuine shadcn/Radix UI primitives, Zod browser-contract validation, AI SDK
  streaming, Markdown, citations/evidence, session history, reset, retry,
  keyboard, and focus behavior.
- Structured, sanitized JSON ingestion/API logs and OpenTelemetry FastAPI/HTTPX
  instrumentation. Full document content and secrets are excluded.
- Non-root runtime containers, dropped capabilities, no-new-privileges,
  read-only Graphify root filesystem, and a constrained initialization job.
- Frontend dependency remediation reduced `npm audit` from 21 advisories to 0.

## Documents discovered

The committed inputs are byte-identical to the supplied source files and valid
UTF-8:

| Document | SHA-256 |
| --- | --- |
| `ley-100-de-1993.md` | `606115c7a542930cb5da4b22d64145d157e38b50b5bed03bed0c439d9a1b2d99` |
| `ley-2381-de-2024.md` | `df13a6a1eebbaeb33579c335e432bb89282013b1c696e011fed186afe418a16b` |
| `ley-797-de-2003.md` | `3286ab2e79db9db06c83a7d43b40c2a570985cace40e4ca719b1c75f484d1403` |
| `resoluci-n-1271-de-2023.md` | `a27a1088780ea697e582a829a12a7cf64c1d4856dcd4bec0219ebc23c6bd9990` |

## Executed verification

| Check | Actual result |
| --- | --- |
| Backend pytest | 117 passed; repeated three times after SSE test cleanup |
| Backend Ruff / format | Passed; 62 files formatted |
| Backend strict mypy | Passed; 48 source files |
| Frontend Vitest | 13 passed in 3 files |
| Frontend ESLint / TypeScript / Next build | Passed |
| Frontend `npm audit` | 0 vulnerabilities (0 production and total) |
| Compose configuration, real and synthetic | Passed |
| Final synthetic image build | Passed; `npm ci` reported 0 vulnerabilities |
| Synthetic service health | Graphify test double, API, and web healthy |
| Synthetic HTTP smoke | UI, API, and `/docs` passed |
| Synthetic Playwright | 3 passed after the final AI SDK upgrade |
| Dependency-down/recovery Playwright | 1 passed; clean error, retry, restart, cited answer |
| Synthetic restart | All services returned to healthy; post-restart smoke passed |
| Live real Graphify MCP contract | Passed against Graphify 0.9.18 |
| Default real image build | Graphify, API, ingestion, and web images built |
| Default real startup | Failed explicitly at `knowledge-ingest` with exit 1 |
| Persisted real knowledge status | `unavailable`; active graph version is `null` |
| Real four-law Spanish smoke | Not executed; no active generated law graph |

The live Graphify contract probe used the official MCP SDK and the production
adapter. It validated the exact schemas and operations for `query_graph`,
`get_node`, `get_neighbors`, and `shortest_path`, including accented,
unaccented, and uppercase Spanish query variants. Graphify's installed query
engine returned equivalent fixture nodes for those forms.

Captured contract fixtures also pass, but they are explicitly not reported as
live-server validation.

## Corpus ingestion blocker

The current default Compose attempt recorded four validated documents,
`graphifyVersion=0.9.18`, a sanitized `graphify_build_failed` event, ingestion
exit 1, and no active graph. API, web, and Graphify remained unstarted because
their dependency conditions correctly stopped the chain.

An earlier diagnostic run with the same host extraction configuration reached
the provider and received HTTP 401 `invalid_api_key`. Graphify documents
require a semantic extraction LLM; this credential is unrelated to Graphify's
MIT license. Supply a valid `OPENAI_API_KEY` (and optional compatible
`OPENAI_BASE_URL`/`OPENAI_MODEL`) and run:

```bash
make knowledge-rebuild
docker compose up -d
make smoke-spanish
```

Do not record a real-law smoke result until those commands produce and activate
a validated graph.

## Synthetic versus real validation

- **Synthetic:** validates deterministic UI/API/SSE behavior, normalized
  citations/evidence, conversation state, Spanish mock behavior, ingestion
  orchestration, and failure preservation.
- **Captured real contracts:** validate parsing of recorded Graphify 0.9.18
  schemas/responses without a running server.
- **Live real MCP:** validates the installed Graphify 0.9.18 server, HTTP MCP,
  official SDK, four-tool schema compatibility, and production adapter against
  a minimal native graph.
- **Not yet validated:** generation and querying of the four-law graph and the
  full real-Graphify/real-LLM Spanish answer flow.

Synthetic MCP tests do not validate compatibility with the real Graphify
runtime.

## Remaining production-readiness work

- Provide a valid extraction provider credential and complete the four-law
  graph plus real Spanish smoke test.
- Set `KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED=false` outside isolated local
  development; add authentication/authorization before any shared admin plane.
- Add container CPU, memory, PID, and writable-storage quotas.
- Pin the Python dependency set with a reproducible lock and automate dependency
  scanning for both ecosystems.
- Add persistent/distributed conversation storage if multiple API workers or
  durable history are required.
- Add an external OpenTelemetry collector/metrics backend and operational
  alerts.
- Harden future writable/untrusted sources with directory-FD traversal and a
  quarantine/authorization design before adding uploads.
