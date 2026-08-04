# AGENTS.md

This file applies to the entire repository. Follow a more specific `AGENTS.md`
if one is added below a subdirectory in the future.

## Project purpose

This is a local proof of concept for evidence-grounded chat over legal and other
documents. The default stack uses:

- Graphify `0.9.18` as the authoritative entity/relationship graph.
- Haystack `2.31.0` over a durable SQLite FTS5 source-text index.
- FastAPI, LangGraph, LiteLLM, Pydantic, and SQLAlchemy in `apps/api`.
- Next.js 15, React 19, TypeScript, Tailwind, Radix/shadcn primitives, and the
  Vercel AI SDK in `apps/web`.
- Docker Compose for the supported local runtime.

Graphify receives unchanged source files. The source index receives normalized
text produced from `.md`, `.txt`, `.html`/`.htm`, `.pdf`, and `.docx` files.
PDF OCR is intentionally out of scope.

## Repository map

- `apps/api/app/api`: FastAPI routes, SSE transport, and dependency composition.
- `apps/api/app/agent`: bounded LangGraph orchestration and grounding policy.
- `apps/api/app/integrations/graphify`: the only code that understands native
  Graphify MCP payloads.
- `apps/api/app/integrations/haystack`: scoped source-text ranking and bounded
  parent reconstruction.
- `apps/api/app/integrations/llm`: provider-neutral model boundary and LiteLLM
  adapter.
- `apps/api/app/knowledge`: secure discovery, conversion, chunking, indexing,
  versioning, activation, and rollback.
- `apps/api/app/store`: durable conversation persistence.
- `apps/web/src/app/api`: browser-facing Next.js proxy routes.
- `apps/web/src/components`: chat and evidence UI.
- `apps/web/src/lib/contracts.ts`: runtime-validated browser contract.
- `contracts`: frozen public HTTP, SSE, answer/evidence, MCP, and knowledge
  schemas.
- `knowledge/input`: operator-supplied source documents.
- `docs/adr`: architecture decisions. Add an ADR for a breaking contract or
  architectural change.
- `tests/e2e`: Playwright synthetic, recovery, and real-Spanish suites.

Start with `README.md`, then consult the relevant document under `docs/` before
changing a boundary. Some older narrative documents may lag implementation;
prefer executable contracts, current code, tests, and the root README when they
disagree.

## Non-negotiable invariants

### Grounding and retrieval

- Graphify runs first and defines the allowed documents/articles for source
  retrieval. Haystack must never broaden that scope.
- Relationship claims require graph evidence. Legal or source-text claims
  require exact source-passage evidence.
- Citation IDs returned by a model must match the request allowlist. Never
  manufacture, repair, or infer an unsupported citation.
- Conversation history is untrusted context, not factual evidence. Retrieve
  fresh evidence for every answer.
- Insufficient evidence must produce an explicit insufficient response, not a
  plausible answer inferred from labels or prior turns.
- Keep tool calls, traversal depth, result counts, evidence bytes, history,
  model iterations, and request duration bounded.

### Provider and MCP boundaries

- The browser never receives provider credentials, Graphify credentials, raw
  MCP payloads, prompts, tool arguments, or hidden reasoning.
- Only the reviewed Graphify operations `query_graph`, `get_node`,
  `get_neighbors`, and `shortest_path` are allowed.
- Project IDs, project paths, and tool names come from trusted server
  configuration, never model output or document content.
- LiteLLM answer and follow-up calls use operation-specific strict JSON Schemas.
  Keep runtime Pydantic validation as a second boundary; do not relax schemas to
  make malformed model output pass.
- Provider exception bodies may contain secrets or request data. Preserve causes
  for server diagnostics only and expose normalized public errors.

### Knowledge ingestion

- Preserve original bytes and compute checksums from those bytes before
  conversion.
- Reject symlinks, unsupported files, invalid signatures/containers, unsafe ZIP
  entries, encrypted or textless PDFs, malformed conversions, decompression
  bombs, and configured size/count limit violations.
- HTML conversion is local-only and must not fetch links or resources.
- Structural chunks may not cross configured page, Markdown heading, or legal
  article boundaries. Token overlap is only between sibling leaves.
- IDs, offsets, token counts, and processing fingerprints must be deterministic.
- Conversion, Graphify extraction, index construction, and profile failures are
  atomic: never replace the active graph/index with a partial build.
- Never edit generated graph/index state as source code or copy proprietary
  source material into tests. Use minimal synthetic fixtures.

### Public contracts and streaming

- Public JSON names are camelCase; Python models translate at the boundary.
- Contract changes must update backend models, contract schemas/OpenAPI, browser
  validation/types, tests, and documentation together.
- Additive optional fields are compatible. Renames, removals, meaning changes,
  and event-order changes require an ADR and an explicit migration/versioning
  decision.
- Every SSE request ends in exactly one `message.completed` or
  `message.failed`. A tool start precedes its matching completion.
- IDs are opaque. Do not make clients depend on their internal format.

## Development workflow

1. Inspect the relevant implementation, tests, and contracts before editing.
2. Reproduce bugs with the smallest realistic request. For intermittent model
   failures, distinguish retrieval, follow-up resolution, answer generation,
   grounding validation, and transport before changing behavior.
3. Make the smallest coherent change. Do not alter legal/business behavior to
   mask a technical failure, and do not weaken a validation boundary merely to
   accept one bad payload.
4. Add a regression test at the layer where the defect occurred.
5. Run focused checks first, then the broader suite appropriate to the risk.
6. Report what was verified and any checks that could not run.

The worktree may contain user changes from other tasks. Inspect `git status` and
the relevant diff before editing. Preserve unrelated modifications; never reset,
restore, reformat, or delete them as cleanup.

## Coding conventions

### Python API

- Target Python 3.12.
- Keep strict Pydantic models at external and persistence boundaries.
- Use async APIs end to end; avoid blocking I/O in request paths.
- Ruff is authoritative for formatting/imports, with an 88-character line
  length. Mypy runs in strict mode.
- Keep provider-specific behavior inside integration adapters and orchestration
  policy inside `app/agent`.
- Catch narrow exception types where recovery is valid. Do not expose stack
  traces or raw dependency errors in API/SSE responses.

Focused commands, when a local environment is installed:

```bash
cd apps/api
ruff format app tests
ruff check app tests
mypy app
pytest -q -p no:cacheprovider tests/path/to/test_file.py
```

The canonical containerized checks are `make test-api` and `make lint`.

### TypeScript web app

- Keep TypeScript strict and validate backend data with the existing Zod
  contracts before rendering.
- Use existing Tailwind theme tokens and Radix/shadcn primitives; do not create a
  parallel color or interaction system.
- Preserve semantic landmarks, keyboard behavior, visible focus, 44px practical
  touch targets, and text labels for confidence/provenance/status.
- Never hide or clip evidence to solve layout bugs. Test evidence UI at 320px,
  at 200% browser zoom, with keyboard navigation, and while scrolling.
- Do not render user input or model output as trusted raw HTML.

Focused commands:

```bash
cd apps/web
npm test -- --run src/path/to/component.test.tsx
npm run typecheck
npx prettier --check src/path/to/file.tsx
npm run build
```

The canonical containerized checks are `make test-web` and `make lint`.

## Runtime and end-to-end verification

Common commands:

```bash
make setup
make dev
make test
make lint
make compose-check
make smoke
make knowledge-status
```

- Normal Compose startup uses the real Graphify runtime and ingestion pipeline.
- Synthetic mode is explicit:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.synthetic.yml up --build
  ```

- `make e2e` uses the synthetic stack. It verifies deterministic application
  behavior, not real Graphify extraction or real-model answer quality.
- `make test-graphify-real` checks the installed Graphify package contract.
- `make smoke-spanish` requires a healthy real stack and configured provider.
- `make clean` removes the persistent knowledge volume. It is destructive and
  must not be run unless the user explicitly requests that state removal.

When rebuilding only one service for verification, prefer a scoped Compose
build/restart and confirm `/ready` before exercising requests.

## Secrets and sensitive data

- Never print, read into output, commit, or expose `.env` values, API keys,
  provider headers, or proprietary documents.
- Inspect configuration by variable name or presence only. Do not search or dump
  `.env` contents.
- Never place secrets in `NEXT_PUBLIC_*` variables, browser code, fixtures,
  screenshots, logs, or error messages.
- If a secret is exposed, stop displaying it and tell the user to revoke/rotate
  it without repeating the value.

## Documentation expectations

Update documentation when behavior, configuration, contracts, supported source
formats, commands, or operational guarantees change. Keep examples free of real
credentials and proprietary content. State clearly whether evidence came from a
synthetic fixture, a package contract test, or a real ingested graph.
