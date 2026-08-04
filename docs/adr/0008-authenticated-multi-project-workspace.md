# ADR 0008: Authenticated multi-project workspace

- Status: Accepted
- Date: 2026-08-03

## Context

The original POC exposed one server-configured corpus and treated conversation
identifiers as bearer capabilities. It could not safely accept browser uploads,
retain multiple independent corpora, or authorize project lifecycle operations.

## Decision

Use Keycloak Authorization Code flow with PKCE S256 for browser login and verify
every API bearer token independently against the configured public issuer,
audience, expiry, signature, and realm roles. `viewer`, `editor`, and `admin` are
composite realm roles. Tokens remain in browser memory and are forwarded only
through the same-origin Next.js proxies.

Store projects, immutable snapshots, content-addressed blobs, resumable upload
sessions, durable build jobs, idempotency records, and audit events in the shared
SQL database. Uploaded bytes live beneath a server-generated project UUID. A
single worker seals and builds snapshots, validates both graph and source index,
then activates them with a generation compare-and-set.

Start Graphify 0.9.18 without a default graph. Each retrieval request is pinned
to the conversation's active graph version and passes only the registry-derived
immutable version directory as `project_path`. The matching version-local source
index is used for the same request.

Conversation creation now requires a ready, non-archived project. The migration
deletes legacy conversation rows; it does not delete unreferenced legacy graph
files.

## Consequences

- Projects are visible to every authenticated viewer; roles, not ownership,
  determine mutations.
- Uploads and builds are explicit and recoverable. Chat can continue against the
  prior active version while editors prepare a rebuild.
- Public project and authentication contracts are breaking changes from the
  unauthenticated single-project POC.
- Local Keycloak `start-dev` is a development facility, not a production HA or
  TLS deployment.
