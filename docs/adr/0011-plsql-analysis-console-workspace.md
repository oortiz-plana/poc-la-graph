# ADR 0011: PL/SQL analysis console as an authenticated workspace

- Status: Accepted
- Date: 2026-09-04

## Context

The PL/SQL dependency and impact analysis platform is split across two
repositories: the analysis side (`/home/oortiz/oao/plsqlgraph`) parses PL/SQL
with Xtext/EMF, projects a semantic graph, and synchronizes it into Neo4j; the
UI side is this repository, which today hosts the Graphify Knowledge Agent web
application. The product requirement (source
`arch/PL-SQL Dependency and Impact Analysis Architecture (1).md`) asks for a
developer console with object search, call hierarchy, table dependencies,
dependency paths, source navigation, impact analysis, and an interactive
graph.

This repository's web app is a Next.js 15 application with one consistent
application shell (`apps/web/src/components/application-shell.tsx`), Keycloak
authentication (`AuthProvider`), same-origin backend proxies, and a
runtime-validated browser contract (`apps/web/src/lib/contracts.ts`). Its
current domain model — document projects, uploads, knowledge builds,
conversations — belongs to the legal-chat product and must not be coupled to a
developer analysis console.

## Decision

Add a dedicated top-level **PL/SQL analysis console** at `/plsql` in
`apps/web`, as an authenticated workspace inside the existing application
shell:

- `apps/web/src/app/plsql/page.tsx` is a thin Server Component that renders
  `<AuthProvider><PlsqlAnalysisWorkspace /></AuthProvider>`, following the
  existing pattern used by `/` and `/governance`.
- The workspace renders `ApplicationShell` and is added as a link in
  `ApplicationNavigation` (`application-shell.tsx`), so it shares the same
  header, responsive navigation drawer, focus handling, and accessibility
  conventions as every other screen.
- The console reuses Keycloak authentication and realm roles for capability
  gating, but it does **not** reuse document projects, conversations, uploads,
  or knowledge builds. Its server configuration (connected analyzed corpus,
  source root, analysis graph) is deployment configuration owned by the
  analysis API, never client input, mirroring the invariant that project IDs
  and paths come from trusted server configuration.
- The console consumes a new authenticated analysis contract namespace
  (`/api/v1/plsql/...`) through the existing Next.js same-origin proxy and the
  `api.ts`/`contracts.ts` client conventions, with Zod validation before
  rendering (see ADR 0013).
- The workspace is shown only when the analysis feature is configured; an
  explicit, accessible "Analysis is not configured / unavailable" state
  separates configuration gaps from query failures.

## Consequences

- The legal-chat product surface is untouched: no changes to project,
  conversation, knowledge, or governance contracts or flows.
- A new backend router and integration package are required in `apps/api`
  (ADR 0012), and a new contract surface and shared schemas are required
  (ADR 0013).
- The console must follow `docs/graphify-enterprise-ux-guidelines.md`,
  `docs/ui/ui-guidelines.md`, and the component inventory; evidence views stay
  textual-first (ADR 0014).
- E2E verification for the console runs against the deterministic synthetic
  stack (ADR 0015); it is independent of the real analysis runtime.
- UI navigation and role gating change only inside this new workspace; no
  existing page, nav item, or component is modified except to add the console
  entry point.
