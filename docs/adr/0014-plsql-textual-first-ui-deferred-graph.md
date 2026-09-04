# ADR 0014: Textual-first analysis UI; graph and editor deferred

- Status: Accepted
- Date: 2026-09-04

## Context

The source architecture ([`arch/PL-SQL Dependency and Impact Analysis
Architecture (1).md`](../../arch/PL-SQL%20Dependency%20and%20Impact%20Analysis%20Architecture%20(1).md))
recommends Cytoscape.js for interactive dependency graphs and a Monaco or
CodeMirror source viewer. This repository's binding UI rules are different:
`docs/ui/ui-guidelines.md` and the component inventory make a structured
textual representation mandatory — nodes show label before ID, edges render as
`source → relationship → target`, paths are ordered lists, provenance is
always textual, and any graph visualization is an optional enhancement that
must remain redundant with the text view and hidden from assistive technology.
The repository also requires explicit confirmation before adding any new
dependency, and today it ships no graph or code-editor library (only Radix
dialog/dropdown/tooltip, lucide icons, and react-markdown). Reusing the
existing evidence-drawer presentation (`EvidenceTextView`,
`apps/web/src/components/evidence-drawer.tsx`) keeps the analysis console
consistent with the chat surface.

## Decision

The PL/SQL analysis console renders **textual-first** analysis views for the
MVP, using existing primitives (Button, Badge, Card, Sheet/Dialog, ScrollArea,
Separator, Tooltip), semantic Tailwind tokens, and the same progressive
disclosure and accessibility rules as the rest of the application:

- Object search and details: labeled object summaries with type, schema,
  qualified name, and lifecycle metadata.
- Callers/callees and table access: grouped lists with explicit relationship
  labels (`CALLS`, `READS`, `WRITES`, `VIEW_DEPENDS_ON`, `TRIGGER_ON`,
  `INDEXES`, `SYNONYM_FOR`, `DECLARES`, `CONTAINS`) and resolution badges
  (`EXACT`, `INFERRED`, `AMBIGUOUS`, `UNRESOLVED`).
- Dependency paths: ordered path lists (`source → relationship → target`
  chains) with hop count and truncation notices; never an unbounded message.
- Impact reports: grouped severity/scope sections with their explaining paths.
- Source view: a **read-only** viewer that opens files from server-provided
  content and scrolls to a highlighted source range; line numbers and
  range-highlight implemented without a code-editor library for the MVP.

Interactive graph visualization and an advanced code editor are **deferred**:

- A Cytoscape.js integration (upstream ADR-002) remains optional and may only
  be added behind a spike that proves redundant-text parity, 320px/200% zoom
  behavior, keyboard fallback, and reduced-motion handling — and after an
  explicit dependency decision. No new graph library is added in the MVP.
- Monaco/CodeMirror (upstream ADR-003) are not adopted for the MVP; the
  read-only viewer must satisfy the "open file, line numbers, scroll to and
  highlight a range, search, copy path" MVP bar before any editor library is
  reconsidered.
- Every view keeps a structured text representation available to assistive
  technology and to deterministic component tests.

## Consequences

- Deterministic, dependency-free components: unit and E2E tests assert text and
  accessible names instead of canvas/DOM of a third-party graph library.
- Bundle size and accessibility risk stay flat while the analysis contract and
  query behavior stabilize.
- A later interactive-graph ADR can supersede this one for the visualization
  layer without changing contracts, backend services, or text views.
- Source content is rendered as server-provided text only; it is never
  assembled into raw HTML in the browser.
