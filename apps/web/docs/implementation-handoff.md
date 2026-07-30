# Frontend UI Implementation Handoff

The canonical product guidance is:

- `docs/ui/ui-guidelines.md`
- `docs/ui/component-inventory.md`
- `docs/ui/interaction-states.md`

## Implementation priorities

1. Implement the normalized event-to-state mapping before visual polish.
2. Keep a single active stream per conversation and use the completion event as authoritative.
3. Render Markdown safely and present normalized citations/evidence only.
4. Build the mandatory textual evidence view before an optional Cytoscape.js visualization.
5. Add keyboard, focus, live-region, interruption, and responsive behavior as part of each component rather than as a later pass.

## Acceptance hooks for tests

Prefer semantic queries, but expose stable accessible names:

- Page heading: “Graphify Knowledge Agent”
- Connection statuses: “Checking API connection”, “API connected”, “API unavailable”
- Composer label: “Ask a question”
- Actions: “Send question”, “Stop response”, “Retry answer”, “View sources”, “View evidence”, “Reset conversation”
- Evidence region/dialog: “Answer evidence”
- Activity text: “Searching Graphify” and “Writing an evidence-grounded answer”
- Insufficient heading: “Not enough evidence in this project”

Recommended test-facing state assertions:

- The user message appears before the first stream event.
- `tool.started` makes Graphify activity visible.
- Deltas append in order to one assistant region.
- Citation IDs are deduplicated.
- `message.completed` replaces/reconciles partial metadata.
- Clarification responses render as ordinary assistant text without source or
  graph-evidence actions.
- Failures retain the submitted question and expose Retry.
- A `conversation_busy` conflict retains history and asks the user to wait.
- Reset requires confirmation when history exists.
- The textual evidence view is present whether or not graph visualization loads.

## Contract assumptions

- The frontend consumes camelCase normalized answer fields defined by the shared contract.
- Stream events are `message.started`, `tool.started`, `tool.completed`, `answer.delta`, `citation.available`, `message.completed`, and `message.failed`.
- The API returns user-safe error categories/messages; the UI still uses a generic fallback for malformed events.
- Project ID is deployment configuration supplied through a non-secret public setting or safe API metadata. MCP URLs, project filesystem paths, model settings, and credentials never enter the browser bundle.
- The browser keeps only the opaque active conversation ID in `localStorage`;
  durable messages and evidence remain in the API store. If that ID has
  expired, the UI creates a new conversation and explains the continuity
  reset.
