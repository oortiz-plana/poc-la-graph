# Graphify Knowledge Agent — Enterprise UX Guidelines

## 1. Product experience goals

The interface should communicate:

- Trustworthiness and evidence-first behavior.
- Enterprise readiness.
- Clear separation between navigation, conversation, and evidence.
- Professional density without appearing cramped.
- Consistent behavior across projects, conversations, files, and administrative screens.

The product should feel like an enterprise knowledge and legal research workspace, not a generic chat application.

---

## 2. Application shell

Use one consistent application shell across all screens.

### Global header

Include:

- Product name.
- Current environment, when relevant.
- API or platform status.
- User menu.
- Optional organization or tenant selector.

Avoid placing project-specific controls in the global header.

### Left navigation

The navigation should support:

- Projects.
- Conversations.
- Files.
- Knowledge builds.
- Audit.
- Administration.
- Settings.

Use responsive constrained sizing instead of fixed widths.

```css
grid-template-columns:
  clamp(13rem, 16vw, 18rem)
  minmax(0, 1fr)
  clamp(20rem, 27vw, 30rem);
```

Treat these values as initial constraints rather than mandatory constants.

### Responsive layout modes

- **Wide screens:** left navigation, main workspace, and right evidence panel.
- **Medium screens:** navigation becomes an overlay drawer; main workspace and evidence remain visible.
- **Small screens:** only the main workspace remains persistent; navigation and evidence open as drawers or sheets.
- Avoid horizontal page scrolling.
- Allow side panels to collapse.
- Let the main workspace consume the remaining width with `minmax(0, 1fr)`.

---

## 3. Page layout

### Projects page

Use a responsive card grid.

```css
grid-template-columns:
  repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
```

Limit excessive expansion on ultrawide screens with a suitable maximum content width.

Each project card should contain:

- Project name.
- Status.
- Short description.
- Active-document count.
- Last update time.
- One primary action.
- Secondary actions in an overflow menu.

Example:

```text
Legal knowledge base                      Ready
Colombian pension legislation and supporting documents.

24 active documents · Updated 2 hours ago

[Open project]                         [More actions]
```

Use contextual actions by status:

- Ready → Open project.
- Draft → Continue setup.
- Processing → View progress.
- Failed → Review error.

### Conversation page

Use:

- Left navigation for project and conversation management.
- Central conversation workspace.
- Right evidence panel.
- Sticky composer attached to the conversation region.

Avoid large empty gaps between the latest response and the composer.

---

## 4. Typography

Use a professional, restrained hierarchy.

- Page title: `24px`.
- Section title: `18–20px`.
- Card title: `15–16px`, semibold.
- Body text: `14–16px`.
- Metadata: `12–13px`.
- Use normal or medium weights for most interface text.
- Reserve bold text for high-priority labels and key claims.
- Keep answer line length near `65–80 characters`.

Avoid very small text, excessive uppercase labels, and heavy font weights.

---

## 5. Spacing and geometry

Use an 8px spacing system.

Recommended values:

- `4px`: compact internal spacing.
- `8px`: related control spacing.
- `16px`: standard content spacing.
- `24px`: section spacing.
- `32px`: major section separation.

Geometry:

- Border radius: `6–8px` for controls and cards.
- Use subtle borders.
- Use minimal shadows.
- Avoid nested cards.
- Avoid excessive outlined containers.
- Keep interactive targets at least `44 × 44px` where practical.

---

## 6. Color system

Use semantic design tokens instead of raw colors inside components.

### Core palette

| Token | Hex | Usage |
|---|---:|---|
| `background` | `#F7F8FA` | Application background |
| `surface` | `#FFFFFF` | Cards, panels, drawers |
| `text-primary` | `#101828` | Main text |
| `text-secondary` | `#475467` | Supporting text |
| `text-muted` | `#667085` | Metadata and helper text |
| `border` | `#D0D5DD` | Borders and dividers |
| `primary` | `#175CD3` | Main actions and selected controls |
| `primary-hover` | `#1849A9` | Hover and active state |
| `selected-background` | `#EFF4FF` | Selected navigation and contextual emphasis |

### Semantic colors

| Token | Hex | Usage |
|---|---:|---|
| `success` | `#067647` | Ready, connected, completed |
| `warning` | `#B54708` | Processing, partial evidence, attention |
| `error` | `#B42318` | Failed, destructive, rejected |
| `information` | `#026AA2` | Neutral informational state |

Recommended tinted backgrounds:

| State | Background | Border |
|---|---:|---:|
| Success | `#ECFDF3` | `#ABEFC6` |
| Warning | `#FFFAEB` | `#FEDF89` |
| Error | `#FEF3F2` | `#FECDCA` |
| Information | `#F0F9FF` | `#B9E6FE` |

### Color rules

- Never use color as the only status indicator.
- Combine color with text and, where useful, an icon.
- Use the primary blue for high-priority actions and active navigation.
- Avoid decorative gradients.
- Avoid using semantic colors as large page backgrounds.
- Keep the interface predominantly neutral.

---

## 7. Interaction rules

- Use one primary action per page or card.
- Place secondary actions in menus or secondary buttons.
- Destructive actions require confirmation.
- Use a clear danger style for permanent deletion.
- Preserve drafts, selected panels, and scroll position.
- Disable mutations while a response is streaming and explain why.
- Use skeleton loading states where possible.
- Avoid layout shifts while content loads.
- Keep focus states visible.
- Support keyboard navigation.
- Use Escape to close drawers and dialogs.
- Return focus to the triggering element after closing a panel.

---

## 8. Conversation management

Support:

- New conversation.
- Resume most recent conversation.
- Search conversations.
- Rename inline.
- Archive and restore.
- Confirmed permanent deletion.
- Active and archived filters.
- Stable pagination ordered by latest activity.

Guidelines:

- Do not expose raw conversation IDs.
- Highlight the active conversation clearly.
- Put rename, archive, and delete in an overflow menu.
- Prevent mutation while an answer is streaming.
- Show retention rules in administrative or policy details, not in the primary workspace.

---

## 9. Answer presentation

Structure grounded answers as:

1. Direct answer.
2. Categorized details.
3. Legal or factual basis.
4. Inline citations.
5. Limitations or warnings.
6. Related follow-up questions.

For legal answers:

- Use exact terminology from the source.
- Separate affiliate death, pensioner death, survivors’ pension, and pension substitution.
- Avoid unsupported generalizations.
- State when eligibility depends on claimant-specific facts.
- Do not present generated summaries as verbatim quotations.

Example:

```text
Según el artículo 49 de la Ley 2381 de 2024, los posibles beneficiarios son:

**Cónyuge o compañero(a) permanente**
- Puede aplicar una prestación vitalicia o temporal según las condiciones legales. [1][2]

**Hijos**
- Menores de 18 años. [3]
- Entre 18 y 25 años cuando estudian y dependen económicamente del causante. [3]
- Hijos inválidos mientras subsistan las condiciones de invalidez. [4]
```

---

## 10. Citations and evidence

Do not expose raw identifiers such as:

```text
(source:6800f42bd2da3d039df5ab1a)
```

Render user-facing numbered citations:

```text
...mientras subsistan las condiciones de invalidez. [4]
```

### Citation behavior

Selecting a citation should:

- Open the evidence panel.
- Scroll to the matching source.
- Expand the corresponding source card.
- Highlight the exact supporting passage.
- Preserve the same citation number when the same source is reused.
- Show a concise preview on hover or keyboard focus.

Example preview:

```text
Ley 2381 de 2024 · Artículo 49 · líneas 844–844
```

### Evidence panel

Separate evidence types:

- Document passages.
- Graph relationships.
- Warnings or insufficient evidence.

Recommended source card:

```text
[4] Artículo 49, literal d)            Direct passage

“Relevant supporting passage…”

Ley 2381 de 2024
Lines 844–844

[Open full passage]
[Graph context]
[Technical details]
```

Technical details may include:

- Internal source ID.
- Graph node ID.
- Knowledge build ID.
- Retrieval method.
- Provenance.
- Correlation ID.

Keep those details collapsed by default.

---

## 11. Grounding and confidence

Avoid unexplained labels such as:

```text
Confidence: High
```

Prefer evidence-oriented trust indicators:

```text
Evidence coverage: Strong
2 directly relevant provisions
6 supporting passages
```

Or:

```text
Grounding
✓ Direct article match
✓ Exact passage available
⚠ Eligibility depends on case-specific facts
```

If confidence remains, explain how it was determined.

---

## 12. Files and knowledge builds

The files area should show:

- File name.
- Type.
- Size.
- Upload date.
- Processing status.
- Active or superseded state.
- Indexing or build status.
- Error details where applicable.
- Authorized actions based on role.

Recommended statuses:

- Uploaded.
- Validating.
- Converting.
- Indexing passages.
- Building graph.
- Ready.
- Failed.
- Superseded.

Do not expose raw ingestion logs in the default view. Place them under technical details.

---

## 13. Loading, empty, and error states

### Loading

Use progressive status only when supported by the backend:

```text
Searching the knowledge graph…
Retrieving source passages…
Preparing the grounded answer…
```

### Insufficient evidence

```text
No encontré evidencia suficiente en este proyecto para responder la pregunta.

Prueba mencionando una ley, artículo, documento o concepto más específico.
```

Do not generate speculative content after declaring insufficient evidence.

### Partial evidence

Clearly separate supported and unsupported portions.

### API unavailable

Preserve the conversation and provide a retry action.

### Failed knowledge build

Show:

- Human-readable problem.
- Recommended recovery action.
- Technical reference under expandable details.

---

## 14. Accessibility

Target WCAG 2.2 AA.

Requirements:

- Keyboard-operable controls.
- Visible focus states.
- Semantic headings.
- Proper buttons instead of clickable generic containers.
- Accessible labels for icon-only controls.
- `aria-live="polite"` for streaming and status updates.
- Minimum text contrast of 4.5:1.
- No reliance on color alone.
- Support 200% browser zoom.
- Respect reduced-motion preferences.
- Keep drawers and dialogs correctly focus-trapped.
- Restore focus after closing overlays.

---

## 15. Responsive behavior

### Desktop

- Three-region layout.
- Independent scrolling by region.
- Resizable or collapsible evidence panel.
- Sticky composer.

### Tablet

- Navigation becomes an overlay.
- Evidence remains visible when space permits.
- Technical controls move into overflow menus.

### Mobile

- Single persistent conversation region.
- Navigation opens as a drawer.
- Evidence opens as a bottom sheet or full-height drawer.
- Composer stays above the virtual keyboard.
- Avoid fixed heights tied to a specific browser chrome size.

---

## 16. Design governance

Create reusable design tokens for:

- Colors.
- Spacing.
- Typography.
- Radius.
- Borders.
- Shadows.
- Statuses.
- Evidence types.
- Z-index layers.
- Breakpoints.

Reuse shadcn/Radix primitives and Tailwind tokens consistently.

Do not:

- Hard-code colors in individual components.
- Introduce one-off spacing values without justification.
- Create duplicate button or card variants.
- Use different layout rules between projects and conversations.
- Expose backend identifiers in the primary UI.
- Make backend implementation concepts the main user-facing labels.

---

## 17. Recommended implementation priorities

### P0

- Introduce semantic color tokens.
- Normalize typography and spacing.
- Establish the enterprise application shell.
- Link inline citations to the evidence panel.
- Hide raw source and graph IDs by default.
- Fix responsive navigation and evidence behavior.

### P1

- Standardize project cards and status actions.
- Add source excerpts and graph-evidence separation.
- Replace generic confidence labels with grounding coverage.
- Improve loading, empty, and error states.
- Add complete keyboard and focus behavior.

### P2

- Add dark mode if required.
- Add user-controlled panel resizing.
- Add audit and administration views.
- Add advanced graph exploration.
- Add configurable density modes.

---

## 18. Open design decisions

Confirm the following before finalizing the design system:

1. Existing company brand, logo, or mandatory colors.
2. Primary user roles.
3. Preferred density: compact or spacious.
4. Desktop-first or equal mobile support.
5. Dark-mode requirement.
6. Supported languages.
7. Formal WCAG acceptance criteria.
8. Tenant and role model.
9. Confirmed navigation sections.
10. Desired product character: legal research, enterprise assistant, or knowledge-management platform.
