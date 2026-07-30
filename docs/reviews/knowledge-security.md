# Knowledge Ingestion Security and Data-Handling Review

Date: 2026-07-29  
Review scope: current Graphify POC and its ingestion of Markdown
laws from:

`/home/oortiz/oao/poc-la-20250512/web-to-markdown/data/laws`

This review defines required controls. It does not authorize a public upload or
administration API.

## Executive summary

The current runtime has an offline/startup ingestion pipeline, a Graphify
subprocess, and configuration-guarded development administration endpoints. It
does not have a document-upload endpoint. Graphify project configuration is
server-side, the source is treated as read-only, and runtime containers use
non-root users.

**High-severity deployment warning:** the unauthenticated administration routes
are enabled by default in current settings. Until authentication and
authorization exist, `KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED` must be false outside a
single-user development environment. A configuration flag is not an
authorization boundary.

The laws source currently contains four regular Markdown files, no symlinks,
and approximately 664 KiB total:

| File | Observed size |
|---|---:|
| `ley-2381-de-2024.md` | 186,631 bytes |
| `ley-100-de-1993.md` | 343,246 bytes |
| `resoluci-n-1271-de-2023.md` | 77,470 bytes |
| `ley-797-de-2003.md` | 63,328 bytes |

Those observations are not a permanent trust guarantee. The ingestion pipeline
must treat every directory entry and every byte of Markdown as untrusted,
including future replacements in the same path.

The preferred operational path is an offline, explicit build command that
creates an immutable, checksummed knowledge snapshot. This isolated local POC
also exposes the same fixed-config operation through a guarded, unauthenticated
development endpoint. That endpoint is an accepted POC exception only and must
be disabled in every shared or production-like deployment.

### Source-port decision

The ingestion service now accepts an asynchronous `KnowledgeDocumentSource`
snapshot port plus a typed `IngestionCommand`. This is intentionally a snapshot
port rather than a filesystem-shaped `list/open` API:

- object storage and a future authorized upload quarantine can validate and
  materialize their own immutable snapshot without leaking storage paths into
  orchestration;
- source implementations retain responsibility for streaming reads, size
  limits, UTF-8 validation, checksums, and consistency while bytes are under
  their control;
- orchestration receives only the bounded provider-neutral snapshot; and
- command fields such as tenant, project, requester, permissions, and source
  type are context metadata only. They do not grant authority.

The filesystem implementation executes blocking discovery in a worker thread
and preserves no-follow opens, regular-file checks, containment, UTF-8
validation, byte limits, and deterministic hashes. Future remote sources should
stream internally and must not buffer an unbounded object before constructing
the same bounded snapshot.

## Trust boundaries and data flow

1. **External source directory:** The laws directory is outside this repository
   and can change independently. It is input, not trusted application code.
2. **Ingestion worker:** Reads a narrowly mounted snapshot, validates it, and
   invokes a fixed Graphify ingestion command or library.
3. **Published graph project:** A versioned output directory becomes immutable
   after successful validation.
4. **Graphify MCP runtime:** Receives only the selected published project,
   mounted read-only where supported.
5. **Agent API:** Receives normalized, bounded graph evidence through the MCP
   adapter. It must never receive an arbitrary host path.
6. **Browser:** Receives only normalized answer, citation, and evidence
   contracts. It must not receive filesystem paths, raw documents, raw MCP
   responses, prompts, credentials, or ingestion logs.

## Required controls

### 1. Source-root and path controls

- Configure one canonical source root. For this dataset, the only allowed host
  root is the exact laws directory above; do not mount
  `/home/oortiz/oao/poc-la-20250512`, `/home/oortiz/oao`, or a home directory.
- Mount the source into an ingestion-only container at a fixed path such as
  `/input/laws:ro`. Do not mount it into the web or API containers.
- Do not accept a source path, project path, output path, or filename over HTTP,
  from the browser, from an LLM, or from document content.
- Resolve the configured root once. For each discovered entry, resolve the
  entry's real path and require it to be a strict descendant of the canonical
  root before opening it.
- Use directory-relative safe open semantics where available
  (`openat`/directory file descriptor plus no-follow behavior). A check followed
  later by a normal path open is vulnerable to a symlink-swap race.
- Allow only regular files. Reject symlinks, hard-linked files when link count
  is greater than one, devices, sockets, FIFOs, and directories below the
  expected traversal depth.
- Do not follow recursive links. Keep recursive traversal disabled for the
  current flat dataset unless a reviewed requirement introduces subdirectories.
- Allow only a conservative filename policy, for example normalized UTF-8
  basenames ending in `.md`, with no control characters, separators, `.`/`..`,
  alternate data stream syntax, or ambiguous Unicode normalization.
- Reject duplicate canonical filenames and case-fold collisions. Record the
  original display filename separately from the internal stable document ID.
- Never derive output paths directly from a document filename. Use generated
  IDs and a controlled output root.

### 2. Symlink and mount controls

- The current source has no symlinks, but every run must re-check.
- Bind-mount source and published projects read-only. A read-only bind mount
  alone does not prevent reading through a link that was already present, so
  application-level no-follow/containment checks remain mandatory.
- Prefer copying validated regular-file bytes into a newly created staging
  directory owned by the ingestion process. Hash while copying, then ingest
  only that staging snapshot.
- Create staging and output directories with restrictive permissions. Do not
  reuse attacker-controlled directories or predictable paths under a shared
  writable location.
- Publish by atomic rename only after all validation and graph generation
  succeeds. Never let Graphify read a partially generated project.
- The runtime-selected `GRAPHIFY_PROJECT_PATH` must remain equal to or beneath
  `GRAPHIFY_KNOWLEDGE_ROOT`. The existing MCP adapter check is necessary, but
  the Graphify container must enforce an equivalent real-path boundary.

### 3. Document count, size, and parser limits

The current dataset is small; limits should be explicit rather than inferred.
Recommended POC ceilings:

- Maximum accepted files per run: **100**.
- Maximum raw bytes per file: **5 MiB**.
- Maximum aggregate raw bytes per run: **50 MiB**.
- Maximum UTF-8 decoded characters per file: **5 million**.
- Maximum line length: **256 KiB**.
- Maximum Markdown nesting depth and parser-node count: configure library
  limits where available; otherwise cap total parsed nodes to **250,000 per
  run**.
- Maximum extracted graph nodes: **100,000 per run**.
- Maximum extracted graph edges: **250,000 per run**.
- Maximum metadata value/excerpt length: **8 KiB**, with longer source content
  retained only in the controlled snapshot, not graph properties.
- Maximum ingestion duration: **10 minutes** for this POC, with termination and
  cleanup on timeout.

Count and size must be checked before expensive parsing and checked again while
streaming bytes. Do not trust filesystem metadata alone because files can
change between `stat` and read. Reject, rather than truncate, source documents;
silent truncation changes legal meaning.

### 4. Content and encoding controls

- Require valid UTF-8. Reject undecodable files; do not silently replace bytes.
- Normalize newlines for parsing while retaining the original content hash.
- Strip or reject NUL and disallowed control characters.
- Parse Markdown with an established library in safe mode. Disable raw HTML,
  external resource fetching, includes, executable directives, macros, and
  plugin discovery.
- Do not render or execute embedded HTML, JavaScript, Mermaid directives,
  templates, shell blocks, or links during ingestion.
- Do not fetch link targets, images, referenced files, imports, or URLs found in
  documents.
- Treat text such as "ignore previous instructions" as ordinary source data.
  Documents must never modify prompts, tool policy, project selection, or
  ingestion configuration.
- Preserve legal structure and provenance: document title, law identifier,
  article/section identifier, source filename, source hash, ingestion version,
  and extraction status. Do not infer a legal proposition without marking it
  inferred.
- Validate that every graph citation resolves to an ingested document and a
  bounded source span. Reject orphan nodes, edges, paths, and citations.

### 5. Subprocess controls

Prefer a Graphify library/API when the supported distribution provides one. If
Graphify ingestion must run as a subprocess:

- Use a fixed executable from the container image and a fixed argument vector.
  Never use `shell=True`, a shell command string, `eval`, or arguments derived
  from document text.
- Pass only internal fixed mount paths and generated snapshot IDs.
- Use a minimal allowlisted environment. Do not inherit model keys, MCP
  credentials, proxy credentials, SSH agents, host `PATH`, or developer
  environment variables.
- Set a dedicated working directory inside the staging area.
- Close inherited file descriptors, provide no stdin, and route unused
  stdout/stderr to `DEVNULL` (or use a strictly bounded collector when
  diagnostics are required).
- Apply wall-clock timeout, CPU quota, memory limit, process-count limit, and
  output-disk quota. Terminate the entire process group on timeout or shutdown.
- Do not run the ingestion subprocess in the API, web, or Graphify MCP runtime
  process. Use an isolated one-shot container or offline job.
- Treat nonzero exit, malformed output, partial graph, timeout, or limit breach
  as a failed build. Do not publish it.
- Never return raw subprocess output to a browser or API caller.

### 6. Container isolation

The ingestion container should:

- Run as a dedicated non-root UID/GID with no host-user mapping requirement.
- Use a read-only root filesystem with a bounded writable staging/output mount
  and a small `tmpfs` for `/tmp`.
- Drop all Linux capabilities; set `no-new-privileges:true`; use the default or
  stricter seccomp/AppArmor profile.
- Have no Docker socket, host PID namespace, host network, privileged mode, or
  device mounts.
- Have no outbound network except the reviewed LLM provider needed by
  Graphify extraction. Graphify itself is open source and requires no license
  service; package downloads belong in the image-build phase.
- Receive only the input read-only mount and a dedicated output volume. It must
  not receive the repository, `.git`, SSH configuration, cloud credentials,
  model API key, or unrelated host paths.
- Use explicit CPU, memory, PID, and disk limits.

The Graphify runtime should receive only the published project read-only. The
API does not need the host laws directory; if it needs a project mount solely
for path validation, prefer a minimal read-only project mount and do not expose
source Markdown unnecessarily.

### 7. Administration and upload boundaries

- This POC intentionally includes a config-guarded, unauthenticated
  development-only endpoint that can start ingestion and inspect status. This
  is an accepted local-development exception, not an authorization design.
- Set `KNOWLEDGE_ADMIN_ENDPOINTS_ENABLED=false` in every shared, reachable,
  staging, or production-like deployment. Keep the enabled endpoint restricted
  to an isolated single-user development environment.
- The development endpoint must not accept a source path, upload, object URL,
  subprocess command, environment value, project filesystem path, delete
  target, or raw-log request. Its fixed server configuration remains the only
  source of those values.
- Do not rely on an obscure URL, localhost assumption, CORS, a project ID, or a
  static frontend secret as authorization.
- Prefer the explicit local operator command or CI job for ingestion even in
  development.
- If a future admin API is required, it is a separate production feature:
  require strong authentication, project-scoped authorization, CSRF protection
  for browser use, audit records, rate limits, idempotency, malware/content
  scanning, quarantine, and a non-public network boundary.
- A future upload flow must stream to quarantine, enforce limits before parsing,
  never preserve client paths, use generated names, and publish only after
  asynchronous validation. Uploading an archive should remain unsupported
  unless a reviewed archive extractor enforces member count, expanded-size,
  compression-ratio, path, symlink, hardlink, and nested-archive limits.
- Conversation endpoints must not be repurposed as an ingestion channel. The
  LLM has no file, URL, shell, administration, or publication tool.

### 8. Logging, telemetry, and error handling

- Log an ingestion run ID, snapshot ID, source-relative safe filename or
  document ID, byte count, hash, stage, duration, counts, and a stable error
  code.
- Do not log raw law content, full extracted excerpts, prompts, MCP responses,
  subprocess output, absolute host paths, environment variables, credentials,
  or stack traces in client-visible responses.
- Prefer document IDs to filenames in routine logs. If filenames are necessary,
  encode control characters and cap length.
- Sanitize parser and Graphify exceptions because they may echo source content
  or paths. Preserve detailed exceptions only in access-controlled diagnostic
  storage with retention limits.
- Metrics should be aggregate counts and timings. Do not put filenames, titles,
  citations, questions, excerpts, or project paths in metric labels or trace
  attributes.
- Never enable automatic capture of LLM prompts/responses or HTTP bodies in
  OpenTelemetry for this pipeline.
- Define retention and deletion for staging files, failed builds, logs, traces,
  published snapshots, and conversation evidence. Failed staging data should be
  removed after diagnosis through a controlled cleanup job.

### 9. Snapshot integrity and provenance

- Generate a manifest containing schema version, ingestion-tool and Graphify
  versions, project ID, creation time, sorted document records, byte sizes,
  SHA-256 hashes, extraction counts, and the complete snapshot hash.
- Pin dependency versions and image digests for reproducible ingestion.
- Verify the manifest before Graphify startup and reject modified or incomplete
  projects.
- Keep source and graph versions immutable. Build a new snapshot instead of
  updating the active directory in place.
- Record the source of the laws and confirm redistribution/licensing terms
  before committing derived content. Public legal text should still have clear
  provenance and update dates.
- Do not claim the graph is legally authoritative or current. Surface the
  source/version date and an informational-not-legal-advice limitation in the
  UI/documentation.

## Current implementation observations

### Controls already present

- The MCP adapter uses the official MCP SDK and an explicit four-operation
  allowlist.
- `GRAPHIFY_PROJECT_PATH` is server configuration and is not accepted from the
  browser or LLM.
- The configured project path is resolved and checked beneath
  `GRAPHIFY_KNOWLEDGE_ROOT`.
- Graphify requests and normalized evidence have tool-call, timeout, node,
  edge, depth, and byte limits.
- The Compose input-document mount and Graphify runtime graph mount are
  read-only. The API knowledge volume is intentionally writable because the
  development ingestion trigger publishes versioned graphs there.
- API, web, and synthetic Graphify images run as non-root users.
- Client-facing errors are normalized and do not expose provider details.
- Structured request logging omits prompts, message bodies, evidence, MCP
  responses, model keys, and Graphify paths.
- No upload, URL-fetch, or arbitrary file tool is exposed to the LLM.
- The source adapter is injected behind an asynchronous snapshot protocol.
- The filesystem source enforces containment, no-follow regular-file opens,
  document/count/aggregate limits, UTF-8, and deterministic checksums.
- Graphify runs with a fixed argument vector and a minimal environment. Model
  keys such as `LLM_API_KEY` and unrelated process secrets are excluded; only
  reviewed OpenAI extraction variables and necessary locale/certificate/proxy
  variables are forwarded.
- Publication uses staged output, validation, versioned targets, and atomic
  activation.

### Gaps for an ingestion extension

- Compose does not currently declare capability drops, no-new-privileges,
  read-only root filesystems, resource quotas, or network isolation.
- Retention and cleanup policy for generated projects, staging data, and
  ingestion logs has not been defined.
- The administration endpoints are unauthenticated and enabled by default.
  They must be disabled outside local development; future upload support
  requires a separately reviewed authorized administration plane.
- The typed `requested_by`, tenant, project, and permission context is not
  authorization and is not yet populated by the current HTTP route.

## Required review checklist

### Design approval

- [ ] Ingestion is offline/one-shot and is not exposed through the
  unauthenticated API.
- [ ] Exact source root and output root are documented and distinct.
- [ ] Only the laws directory, not its parents, is mounted.
- [ ] Data classification, provenance, redistribution terms, and update
  ownership are recorded.
- [ ] Threat model covers malicious Markdown, prompt injection, decompression
  bombs if archives are ever introduced, denial of service, and compromised
  ingestion dependencies.

### Filesystem

- [ ] Canonical root is resolved once and every entry is verified beneath it.
- [ ] Opens are no-follow and race-resistant.
- [ ] Only regular `.md` files with safe normalized names are accepted.
- [ ] Symlinks, hardlinks, devices, sockets, FIFOs, path collisions, and
  unexpected subdirectories are rejected.
- [ ] Input is read-only; staging is private and newly created; output
  publication is atomic.
- [ ] Tests cover `../`, absolute paths, symlink escape, symlink swap, hardlink,
  Unicode collision, overlong filename, and special-file cases.

### Resource bounds

- [ ] Per-file, aggregate-byte, file-count, decoded-character, line-length,
  parser-node, graph-node, graph-edge, output, process, and time limits are
  configured and tested.
- [ ] Limits are enforced while streaming, not only with pre-read metadata.
- [ ] Oversized or malformed legal documents fail closed and are never silently
  truncated.
- [ ] Partial outputs are never published.

### Parsing and Graphify

- [ ] Established safe Markdown parser is used with raw HTML, includes,
  plugins, external fetches, and execution disabled.
- [ ] Document content cannot choose tools, paths, commands, project IDs,
  prompts, or model configuration.
- [ ] Fixed Graphify API/command is used; no shell interpolation exists.
- [ ] Graph schema and referential integrity are validated.
- [ ] Every citation maps to a source hash and bounded source location.
- [ ] Unknown/unmatched content yields insufficient evidence rather than a
  fabricated relationship.

### Container and subprocess

- [ ] Dedicated non-root ingestion UID/GID is used.
- [ ] Capabilities are dropped and no-new-privileges is enabled.
- [ ] Root filesystem is read-only; writable storage and `/tmp` are bounded.
- [ ] Docker socket, devices, privileged mode, host namespaces, unrelated
  mounts, and secrets are absent.
- [ ] Outbound network is disabled or strictly allowlisted.
- [ ] Subprocess uses a fixed executable and argument vector without a shell.
- [ ] Minimal environment, closed file descriptors, bounded output, timeout,
  resource limits, and process-group termination are tested.

### API and browser

- [ ] No upload, delete, path-selection, arbitrary command, or raw-log endpoint
  is introduced. The fixed-config development ingestion trigger is enabled
  only for isolated local use and is disabled for shared deployments.
- [ ] Browser receives no absolute path, raw document, raw MCP result, raw
  subprocess output, credential, or hidden prompt.
- [ ] The LLM retains only bounded Graphify retrieval tools and has no
  filesystem, URL, shell, or admin tool.
- [ ] Any future admin plane undergoes a separate authentication,
  authorization, CSRF, audit, quarantine, and abuse-resistance review.

### Logging and lifecycle

- [ ] Logs use run/snapshot/document IDs and stable error codes.
- [ ] Raw text, excerpts, prompts, bodies, absolute host paths, environment,
  credentials, and raw exception/subprocess output are excluded.
- [ ] Trace and metric attributes contain no document or user content.
- [ ] Snapshot manifest and hashes are verified before activation.
- [ ] Staging, failed build, snapshot, log, trace, and conversation retention
  periods are defined and cleanup is tested.
- [ ] Rollback selects a prior immutable verified snapshot; it does not mutate
  a published project in place.

## Review disposition

The external laws directory is suitable as a small test dataset because the
filesystem source handles it as untrusted, read-only input. The new
storage-independent snapshot port is an appropriate future upload/object-store
boundary, but it does not itself provide authentication or authorization.

**Disable the existing unauthenticated development administration routes in any
shared deployment, and do not add an upload endpoint to them.** Future upload
implementation requires the authorization, quarantine, resource-limit,
container, provenance, and logging controls above plus a follow-up review.
