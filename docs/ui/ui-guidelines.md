# Graphify Knowledge Agent UI Guidelines

## Scope and experience principles

This POC is an authenticated, multi-project conversational workspace. The UI
talks only to the Agent API; it never connects to Graphify or an LLM provider.
Project evidence is shared, while server-backed conversation histories are
private to the authenticated user.

Design priorities:

1. Keep the question, streamed answer, and supporting evidence in one understandable flow.
2. Distinguish retrieved facts from inferred relationships.
3. Make system activity visible without exposing prompts, chain-of-thought, tool arguments, or raw MCP payloads.
4. Make insufficient evidence a useful result, not a generic failure.
5. Preserve user input and completed messages through recoverable errors.
6. Use familiar shadcn/ui primitives and avoid bespoke interaction patterns.

## Information architecture

The page has four persistent regions:

- **Conversation navigation:** project name, New conversation, active history,
  Archived view, and archive/restore/delete controls.
- **Application header:** product name and backend connection status.
- **Project context bar:** read-only configured project name or ID and a short “Answers use this knowledge graph” description.
- **Conversation panel:** ordered user and assistant messages, activity, errors, citations, and an empty-state prompt.
- **Composer:** multiline question input, Send/Stop control, and concise keyboard hint.

Supporting evidence opens in a **citation and evidence drawer**. On wide screens it is a right-side sheet; on narrow screens it is a bottom sheet or full-height dialog. It is not required to remain open while a new answer streams.

## Screen layout

```text
┌───────────────────────────────────────────────────────────────────┐
│ Graphify Knowledge Agent          ● API connected        [Reset] │
├───────────────────────────────────────────────────────────────────┤
│ Knowledge project: sample-project                                │
├───────────────────────────────────────────────┬───────────────────┤
│                                               │ Evidence          │
│ Conversation                                  │ (when open)       │
│                                               │                   │
│ User question                                 │ Citation details  │
│ Assistant activity / streamed answer          │ Graph nodes       │
│ [Sources 3] [View evidence]                    │ Edges and paths   │
│                                               │                   │
├───────────────────────────────────────────────┴───────────────────┤
│ Ask about this knowledge graph…                       [Send]      │
└───────────────────────────────────────────────────────────────────┘
```

The conversation column should remain readable at approximately 48–52rem. On very wide screens, center it until the evidence drawer opens. Keep the composer visually attached to the conversation and sticky at the bottom of the viewport.

## Visual language

- Use the existing shadcn/ui theme tokens through Tailwind; do not hard-code a parallel color system.
- Use neutral surfaces for messages, a subtle accent for the user, and a distinct but restrained surface for assistant output.
- Reserve semantic colors for status: success/connected, warning/inferred or insufficient, destructive/error, and muted/loading.
- Do not communicate confidence, provenance, or connection state by color alone. Pair color with text and, optionally, an icon.
- Render answer Markdown with restrained typography. Sanitize or disallow raw HTML. Links must be visually identifiable and keyboard focusable.
- Keep motion short and functional. Respect `prefers-reduced-motion`; a text status must work without animation.
- Avoid avatars unless they add information. “You” and “Graphify Agent” labels are clearer.

## Message and evidence presentation

### User message

Show the submitted question verbatim with a “You” label. Do not render user-entered Markdown as trusted HTML.

### Assistant message

Show:

- “Graphify Agent” label and current status.
- Streamed Markdown answer in one stable region.
- Confidence label after completion: High, Medium, Low, or Insufficient.
- Graph version when present.
- Warning callouts, if any.
- Source chips or a “Sources (n)” button.
- “View evidence” when normalized nodes, edges, or paths exist.

Never display hidden reasoning, prompts, model configuration, raw tool arguments, raw MCP responses, secrets, stack traces, or provider error bodies.

### Citations

Citation markers in answer text should use stable, human-readable references such as `[1]`. If the backend does not insert inline markers, show a clearly associated Sources section under the completed answer rather than attempting to fabricate claim-level placement.

Each citation presents:

- Numeric marker and title.
- Source name or location.
- Provenance badge: Explicit, Extracted, Inferred, or Unknown.
- Relationship, when present.
- Short excerpt, when present.
- Node ID in secondary metadata, when present.

An Inferred or Unknown badge always includes text and a warning-style treatment. Missing optional fields are omitted rather than shown as `null`. Citation controls open the drawer at the selected item and move focus to its heading.

### Graph evidence

The drawer begins with an accessible text summary and then offers:

1. Citations.
2. Nodes and relationships.
3. Paths.
4. Optional graph visualization.

The textual representation is mandatory even when Cytoscape.js is used. Nodes display label/title before ID. Edges show `source → relationship → target` and explicitly label inferred provenance. Paths are ordered lists. Large results use scrollable sections and progressive disclosure; they must not make the message itself unbounded.

## Content guidelines

- Use direct status language: “Searching Graphify…”, “Preparing an evidence-grounded answer…”, “Graphify is unavailable.”
- Say “Not enough evidence in this project” rather than “I don’t know.”
- Name the recovery action: “Retry answer” or “Check connection,” not “Try again” without context.
- Do not imply a failed answer was saved if it was not.
- Do not describe confidence as certainty. Use “Confidence: Medium.”
- Use sentence case for labels and buttons.

## Responsive behavior

### Small: below 640px

- Header wraps into two rows; connection state remains visible.
- Project context truncates only after exposing the full value through accessible text.
- Messages and composer use the full content width with at least 16px side padding.
- Evidence opens as a full-height dialog or bottom sheet.
- Composer actions remain at least 44×44 CSS pixels.
- Avoid horizontal scrolling in Markdown; code and evidence tables may scroll inside their own containers.

### Medium: 640px–1023px

- Center the conversation column.
- Evidence uses a modal sheet, up to roughly 80vw.
- Header actions remain on one row where space permits.

### Large: 1024px and above

- Evidence uses a persistent right sheet, approximately 360–480px wide.
- Conversation width stays readable and shifts rather than shrinking below its minimum.
- Closing evidence restores the centered conversation layout.

No critical feature may depend on hover. Test at 320px CSS width and at 200% browser zoom without loss of controls or content.

## Accessibility requirements

- Meet WCAG 2.2 AA contrast and interaction expectations.
- Use semantic landmarks: `header`, `main`, conversation region, and `form`.
- Give the conversation an accessible name. Each message is an article with speaker and state.
- Provide one visible page heading.
- Associate the composer label and description programmatically; placeholder text is not a label.
- Enter submits a single-line question; Shift+Enter inserts a newline. During IME composition, Enter must not submit.
- All actions are keyboard reachable with a clear focus ring and logical order.
- The evidence drawer traps focus while modal, closes with Escape, and restores focus to its opener.
- Announce concise status changes through a polite live region. Do not announce every streamed token. Update the visible answer continuously but announce completion or throttled sentence-level summaries.
- Use `role="alert"` for actionable failures. Move focus to an error only when submission cannot continue; do not steal focus for transient reconnect checks.
- The streaming indicator includes visible text and an accessible name. Spinners are decorative.
- Stop streaming is a real button with an accessible name. Reset requires confirmation if the conversation contains messages.
- Confidence and provenance use text, not icons or color alone.
- Graph visualization has an equivalent structured text view and is hidden from assistive technology when redundant.
- Touch targets are at least 44×44 CSS pixels where practical.

## Validation checklist

- Every required interaction state in `interaction-states.md` is implemented.
- Browser requests target only the Agent API.
- No secret or raw MCP/model data appears in DOM content, errors, or client logs.
- Keyboard-only flow supports submit, stop, retry, sources, evidence, close, and reset.
- Screen-reader announcements are useful but do not repeat token deltas.
- Evidence remains understandable with color, animation, and visualization disabled.
- At 320px width and 200% zoom, no primary action is clipped.
