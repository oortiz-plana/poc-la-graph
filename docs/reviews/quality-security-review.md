# Quality and Security Review

> Historical review from the initial POC. Findings and remediations for the
> current knowledge runtime are tracked in `knowledge-security.md` and
> `real-graphify-implementation-report.md`.

Date: 2026-07-28  
Scope: API, agent workflow, Graphify/MCP and LLM adapters, web/BFF,
containers, configuration, tests, and dependency manifests.

## Executive summary

The POC has sound foundational boundaries: the browser does not receive model
or MCP credentials, Graphify access uses the official MCP SDK, MCP operations
are explicitly allowlisted, project identity/path come only from trusted
configuration, provider errors are normalized, React Markdown ignores raw HTML,
and all runtime containers use non-root users.

The review found one high-severity grounding issue that should be addressed or
explicitly accepted as a POC limitation before calling the POC
acceptance-complete. Two earlier integration findings were resolved during the
review. No committed real secret,
arbitrary LLM tool access, direct browser-to-Graphify access, or critical
container privilege issue was found.

## Findings

### QS-01 — High — Citation membership does not prove claim grounding

**Evidence**

- `apps/api/app/agent/workflow.py::validate_grounding` checks that the response
  has citation IDs and that every returned ID belongs to the retrieved citation
  set.
- It does not represent material claims separately or test whether each claim is
  supported by the evidence attached to it.
- `apps/api/app/integrations/llm/models.py` models one answer string and a
  response-level citation list.

**Impact**

A compromised, injected, or simply mistaken model can make an unsupported
material claim, attach one valid retrieved citation, and retain `high`
confidence. The citation is real, but the answer can still be fabricated. This
falls short of the requirement that every material claim be supported.

**Recommendation**

Return structured claims from the model, each with one or more exact evidence
IDs. Deterministically reject claims with absent IDs and render the final answer
only from validated claims. A bounded verifier pass can supplement this, but its
model-based nature must be documented. Add adversarial tests where an answer
contains an unrelated claim plus a valid citation.

### QS-02 — Resolved — Default composed demo citation mismatch

**Evidence**

- `docker-compose.yml` defaults `LLM_ADAPTER` to `mock`.
- The initial implementation returned fixed citation ID `evidence-1`, which did
  not match normalized evidence IDs.
- During review, `DeterministicModel` was changed to extract and return an exact
  normalized `evidenceId` from its request context.

**Impact**

The original out-of-box stack could exercise only the insufficient-evidence
path. The integrated fix now permits the deterministic composed path to return
a citation that passes membership validation.

**Recommendation**

Completed for evidence-ID selection. Retain a default Compose smoke assertion
that a completed answer has at least one valid citation.

### QS-03 — Resolved — Synthetic search invented relevance for no-match queries

**Evidence**

The initial `graphify/mock/server.py::search` returned the first three graph
nodes when no query term matched. That fallback was removed during review.

**Impact**

The initial behavior could treat an unknown question as if Graphify retrieved
relevant evidence.

**Recommendation**

The implementation now returns empty evidence for no-match queries. Retain a
composed regression test expecting `confidence: insufficient`.

### QS-04 — Medium — Unauthenticated process-local state has no resource limits

**Evidence**

- Authentication is intentionally absent, as required.
- `InMemoryConversationStore` has no conversation count, message count, age,
  or memory-size limit.
- The public API can create conversations and append up to 4,000 characters per
  message indefinitely.

**Impact**

Any network client can exhaust API memory over time. This is acceptable only
for a trusted local POC, not for an exposed environment.

**Recommendation**

Document localhost/trusted-network-only operation. Add TTL and bounded
conversation/message limits even before authentication; add rate limiting at
the deployment edge for any shared deployment.

### QS-05 — Medium — Web proxy accepts broadly shaped, unbounded chat JSON

**Evidence**

`apps/web/src/app/api/chat/route.ts` casts `request.json()` to a TypeScript type
without runtime validation and walks an arbitrary `messages` array. Backend
validation limits the extracted question, but only after the BFF has parsed and
processed the body.

**Impact**

Malformed input can cause generic failures, and oversized arrays/bodies consume
memory and CPU in the web process. Zod is used for responses but not this
request boundary.

**Recommendation**

Validate the chat request with Zod, cap message/part counts, cap the extracted
question to 4,000 characters before forwarding, and configure an explicit
request-body limit.

### QS-06 — Resolved — Static quality and test acceptance gates

**Evidence**

- The initial `ruff check .` reported 25 findings. The integrated source was
  subsequently formatted and corrected.
- `npm run lint` and `npm run typecheck` passed.
- The initial `npm test -- --run` reported no test files. During review, two
  component test files with ten tests were integrated and passed.
- The final Python 3.12 container validation passed Ruff check, Ruff format
  check, and 27 pytest tests.

**Impact**

The configured static and unit/component quality gates now pass.

**Recommendation**

Keep these checks in CI. The final browser suite passed three normal-path tests;
the dependency-control resilience test remains opt-in.

### QS-07 — Low — Browser hardening headers are not explicitly configured

**Evidence**

No explicit Content Security Policy, `frame-ancestors`, Referrer-Policy, or
Permissions-Policy configuration was found in `next.config.ts` or a reverse
proxy.

**Impact**

The current React rendering is comparatively safe (`ReactMarkdown` uses
`skipHtml`), but defense-in-depth against future XSS/content additions and
clickjacking is absent.

**Recommendation**

Add an explicit CSP compatible with Next.js, deny framing, and set conservative
referrer and permissions policies before non-local deployment.

### QS-08 — Low — Client-supplied correlation identifiers are logged

**Evidence**

`app/main.py` accepts `X-Request-ID`, truncates it to 128 characters, and logs
it through JSON structured logging.

**Impact**

JSON encoding prevents structural log injection, but control characters can
still reduce readability and untrusted IDs complicate trace integrity.

**Recommendation**

Accept only a conservative request-ID character pattern or always generate the
internal correlation ID while recording a sanitized external ID separately.

## Positive controls verified

- The official `mcp` Python SDK is used for streamable HTTP MCP sessions; no
  custom MCP protocol client was found.
- Only `search`, `get_node`, `get_neighbors`, and `shortest_path` operations are
  accepted, mapped to four unique configured tool names, and verified against
  the server tool list.
- Tool calls, traversal depth, nodes, edges, evidence bytes, query length, node
  IDs, model iterations, provider requests, and overall requests are bounded.
- `project_id` and `project_path` never originate in model output or browser
  requests. The configured project path must resolve beneath the configured
  knowledge root.
- LiteLLM and Graphify exceptions exposed to clients are generic; provider
  response bodies, URLs, credentials, stack traces, and raw MCP responses are
  not returned.
- The browser communicates with same-origin Next.js routes and the API; it does
  not receive `LLM_API_KEY`, the MCP URL, or the Graphify filesystem path.
- Markdown rendering skips embedded HTML. No use of `dangerouslySetInnerHTML`
  was found.
- API, web, and synthetic Graphify runtime images switch to UID/GID 10001.
- CORS is origin-allowlisted and credentials are disabled.
- Mock adapters require explicit configuration; no silent production fallback
  from MCP or LiteLLM was found.
- Secret-pattern review found only documentation placeholders and deliberate
  test values, not a real committed credential.
- Offline npm production audits reported zero known vulnerabilities for the web
  and E2E package trees. This is limited to locally cached advisory data.

## Validation record

| Check | Result |
|---|---|
| Web ESLint | Passed; deprecation/workspace-root warnings only |
| Web TypeScript strict check | Passed |
| Web Vitest | Passed: 2 files, 10 tests |
| API Ruff check and format | Passed in Python 3.12 container |
| API pytest | Passed: 27 tests |
| Browser E2E | Passed: 3 normal-path tests; 1 opt-in resilience test skipped |
| Compose images and health checks | Passed |
| Web offline production npm audit | Passed, 0 reported |
| E2E offline production npm audit | Passed, 0 reported |
| Secret-pattern inspection | No real credential found |

## Review disposition

**Ready as a local POC with a documented grounding limitation.** QS-01 remains
production-readiness work: citation membership is deterministic, but semantic
claim-to-evidence entailment is still model-dependent. QS-04 and QS-05 bound
the deployment to trusted local use. QS-02, QS-03, and QS-06 were resolved.
The low-severity items remain production-hardening work.
