# Interaction State Definitions

## State model

Only one message request may stream per browser conversation in the POC.

```text
booting → empty | ready
ready/empty → submitting → querying_graphify → generating → completed
                                              ↘ insufficient
submitting/querying_graphify/generating → stopped | failed
failed/stopped → retrying → querying_graphify
any non-resetting state → confirming_reset → empty
```

Event-driven mapping:

| Backend event | UI transition | Required presentation |
|---|---|---|
| `message.started` | submitting | Persist user message; create stable assistant placeholder |
| `tool.started` | querying Graphify | “Searching Graphify…” and non-blocking activity indicator |
| `tool.completed` | preparing/generating | “Graph evidence received” briefly, then generation status |
| `answer.delta` | generating | Append delta to the same assistant message |
| `citation.available` | generating | Add/deduplicate source metadata; update source count without opening drawer |
| `message.completed` | completed or insufficient | Reconcile final answer, citations, evidence, confidence, warnings, graph version |
| `message.failed` | failed | Stop activity; render normalized error and retry action |

Unknown event types are ignored and recorded only in development diagnostics. Invalid known events terminate the request safely with a generic stream error; raw payloads are not displayed.

## Detailed states

### Booting / connection check

- Header says “Checking API connection…”.
- Composer may accept typing but Send is disabled until conversation creation and API status resolve.
- Do not use a full-page blocking spinner.
- If checking exceeds a reasonable threshold, change to unavailable rather than spinning indefinitely.

### Empty conversation

- Show a concise purpose statement: answers are grounded in the configured Graphify project.
- Optionally show two or three safe sample-question buttons. Clicking fills the composer but does not submit.
- Show the project indicator and connection state.
- Composer receives focus on desktop after initialization; avoid forced focus on mobile.
- Reset is disabled.

### Ready with history

- Restore messages belonging to the current browser-session conversation.
- Scroll to the latest message on initial restoration.
- Do not persist or imply cross-session history.
- Composer is enabled when the API is connected and no request is active.

### Submitting

- Add the user message immediately and clear the composer visually.
- Create one assistant placeholder.
- Disable duplicate Submit; replace Send with Stop.
- Announce “Question submitted.”
- Preserve the submitted question for retry.

### Querying Graphify

- Display “Searching Graphify…” within the assistant placeholder.
- The status may expose a safe allowlisted operation label (for example, “Searching knowledge graph”) but never arguments, paths, prompts, or raw results.
- Keep Stop enabled.
- Do not invent evidence placeholders or citation counts.

### Generating / streaming

- Render incoming `answer.delta` content in the same Markdown container.
- Keep layout stable and auto-scroll only while the user is already near the bottom. If the user scrolls upward, show a “Jump to latest” control.
- Show “Writing an evidence-grounded answer…” until completion.
- Citation events may increment “Sources (n)” but must not interrupt typing or steal focus.
- Throttle assistive announcements; announce completion rather than every token.
- Stop remains available.

### Completed

- Replace transient activity with final confidence, optional graph version, warnings, citations, and evidence controls.
- Reconcile streamed text with `message.completed.answer`; the completion payload is authoritative.
- Enable composer and place focus there only if doing so will not disrupt a user inspecting evidence.
- Announce “Answer complete.”
- If there are zero citations despite a non-insufficient factual answer, display a grounding warning instead of implying support.

### Insufficient evidence

- Treat `confidence: insufficient` as a successful completed response, not an API error.
- Heading: “Not enough evidence in this project.”
- Render the backend-provided concise explanation and any warnings.
- Show any citations/evidence actually returned, but never manufacture sources.
- Offer “Ask a narrower question” by returning focus to the composer. Do not auto-retry.
- Use a warning/neutral treatment, not destructive error styling.

### Stopped / interrupted by user

- Stop consuming the stream and mark the partial assistant message “Stopped.”
- Clearly label streamed content as incomplete.
- Offer “Retry answer” using the original question and “Edit question” by restoring it to the composer.
- Do not present partial citations as a completed grounded response.

### Failed

Retain the user message. Replace activity with a user-safe error and applicable recovery:

| Category | Message | Action |
|---|---|---|
| Graphify unavailable | “The knowledge graph is unavailable right now.” | Retry answer; connection check continues |
| MCP timeout | “The knowledge graph took too long to respond.” | Retry answer |
| LLM unavailable | “The answer service is unavailable right now.” | Retry answer |
| Invalid model response | “The answer could not be validated.” | Retry answer |
| Empty graph result | Use insufficient-evidence state | Ask a narrower question |
| Overall timeout | “This request took too long.” | Retry answer |
| Invalid API input | Show safe field-level guidance | Edit question |
| Interrupted/network stream | “The connection was interrupted before the answer completed.” | Retry answer |
| Conversation not found after API restart | “This conversation expired.” | Start new conversation, retaining draft |

Never show exception classes, stack traces, internal URLs, Graphify paths, credentials, provider bodies, or raw response payloads.

### Retry

- Retry operates on the failed/stopped user question and creates a fresh request ID.
- Keep the original user message; replace or clearly supersede the failed assistant attempt so duplicate answers are not confused.
- Disable Retry while active and expose Stop.
- Announce “Retrying answer.”
- If conversation expiry caused the failure, create a new conversation before retrying and retain visible browser-session history as local context only if the API contract supports resending it; otherwise label the new conversation boundary.

### Citations available

- Add citations in stable arrival order and deduplicate by citation ID.
- “Sources (n)” opens the evidence drawer and focuses its citation heading.
- Selecting an inline marker opens the corresponding citation.
- A citation can appear before completion, but excerpts and metadata are only treated as final after `message.completed`.
- Provenance must be shown as Explicit, Extracted, Inferred, or Unknown.

### Evidence drawer

- Opening does not pause or restart streaming.
- Initial focus goes to the selected citation heading or drawer heading.
- The default view is textual citations plus structured graph evidence.
- Optional visualization never replaces text.
- Escape/Close restores focus to the opener.
- On completion updates, merge evidence without resetting drawer scroll or focus.
- Empty graph evidence shows “No graph structure was returned for this answer,” not an empty canvas.

### Reset

- If messages exist, open a confirmation dialog: “Reset this browser-session conversation? This cannot be restored.”
- Default focus is Cancel. Escape cancels.
- On confirm, call the delete endpoint, clear local conversation ID/history after success, create a fresh conversation, close evidence, and focus the composer.
- If delete returns not found, clear local state and create a fresh conversation because the intended end state is already satisfied.
- If reset fails for another reason, retain history and show an error; do not silently clear it.
- Reset is unavailable while a stream is active unless the implementation first stops that stream and clearly confirms the combined action.

### Backend disconnected

- Header changes to “API unavailable.”
- Existing messages and evidence remain readable.
- Composer draft is preserved; Send and Retry are disabled.
- Provide a “Check connection” action or automatic low-frequency recheck.
- On recovery announce “API connected” and re-enable actions. Do not auto-submit the draft.

## Scroll, focus, and concurrency rules

- Never create two active streams for one conversation.
- Never move focus on token, citation, or tool events.
- Auto-scroll only when the viewport is close to the newest message.
- Retain draft text on connection and validation errors; clear it after accepted submission.
- An evidence drawer opened for an earlier answer stays associated with that answer.
- Reset closes all overlays and cancels pending client reads before state is cleared.

## State validation scenarios

1. Empty page initializes without a blocking spinner and keyboard focus reaches the composer.
2. Submit immediately displays the user message and exactly one assistant placeholder.
3. Tool events show safe Graphify activity without raw payloads.
4. Multiple deltas append to one answer; citations deduplicate; completion is authoritative.
5. Insufficient evidence is visibly distinct from Graphify/LLM failure.
6. A failed or interrupted request preserves the question and supports one-click retry.
7. Evidence is fully understandable through text with visualization disabled.
8. Reset failure retains history; successful reset produces a fresh empty conversation.
9. Disconnect preserves messages and draft and never auto-submits after recovery.

