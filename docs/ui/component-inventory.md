# UI Component Inventory

Use shadcn/ui primitives where they fit (Button, Badge, Card, Sheet/Dialog, Alert, ScrollArea, Separator, Skeleton, Tooltip). These entries are product components composed from those primitives, not a new component library.

| Product component | Responsibility | Key inputs / states | Accessibility notes |
|---|---|---|---|
| `AppHeader` | Product identity, connection status, reset action | API status, `hasMessages`, reset callback | Header landmark; status is text, not color alone |
| `ConnectionStatus` | Shows checking, connected, unavailable | status, optional retry | Polite live announcement only on meaningful transition |
| `ProjectIndicator` | Shows configured Graphify project | project ID/name | Read-only; full accessible value if visually truncated |
| `ConversationPanel` | Ordered messages and empty state | messages, request state | Named region; stable DOM order |
| `EmptyState` | Sets expectations and offers sample prompts | optional suggested questions | Suggestions are buttons and do not auto-submit |
| `MessageItem` | Speaker label, content, status, actions | user/assistant, request ID, timestamps optional | Article labeled by speaker |
| `AssistantAnswer` | Safe Markdown and completion metadata | answer, confidence, graph version, warnings | Semantic Markdown; sanitized links/HTML |
| `ActivityStatus` | Shows Graphify and answer-generation activity | event-derived activity | One visible text status; no raw tool details |
| `StreamingCursor` | Subtle visual indication only | active | `aria-hidden`; reduced-motion safe |
| `MessageActions` | Sources, evidence, retry | citations, evidence, failed state | Clear button labels and focus order |
| `CitationList` | Compact sources below answer or in drawer | normalized citations | Ordered markers stay stable |
| `CitationCard` | Citation metadata and excerpt | citation contract | Provenance is always textual |
| `EvidenceDrawer` | Detailed citations, graph evidence, warnings | open, selected citation, evidence | Sheet/Dialog semantics; focus management |
| `EvidenceTextView` | Nodes, edges, paths as structured text | graph evidence | Mandatory equivalent to visualization |
| `GraphEvidenceView` | Optional interactive graph | normalized nodes/edges | Redundant with text view; keyboard controls if interactive |
| `WarningCallout` | Inference, truncation, or other warning | warning text/severity | Warning icon is decorative; readable text |
| `InsufficientEvidence` | Completed non-error response | answer, warnings, any partial citations | Distinguish from service failure |
| `Composer` | Question input and submit/stop action | draft, busy, availability | Labeled textarea; IME-safe shortcuts |
| `ErrorNotice` | Normalized user-safe failure and recovery | error category, retry availability | `role="alert"`; no internals |
| `ResetConversationDialog` | Confirms destructive local reset | open, message count | Initial focus on Cancel; restores focus |

## Recommended hierarchy

```text
Page
├── AppHeader
│   ├── ConnectionStatus
│   └── ResetConversationDialog
├── ProjectIndicator
└── Main
    ├── ConversationPanel
    │   ├── EmptyState | MessageItem[]
    │   │   └── AssistantAnswer
    │   │       ├── ActivityStatus
    │   │       ├── WarningCallout
    │   │       └── MessageActions
    │   └── Composer
    └── EvidenceDrawer
        ├── CitationList / CitationCard
        ├── EvidenceTextView
        └── GraphEvidenceView (optional)
```

## Boundary rules

- Components consume the normalized frontend contract, never Graphify MCP objects.
- Stream parsing and API state belong in the client/data layer, not presentational components.
- `AssistantAnswer` renders answer content only; tool activity and errors remain explicit sibling states.
- `GraphEvidenceView` is optional enhancement. `EvidenceTextView` is the source-of-truth presentation.
- A failed request retains the user message and draft/retry context.

