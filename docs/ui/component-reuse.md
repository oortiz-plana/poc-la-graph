# Component Reuse Guidelines

These rules cover how shared React components in `apps/web` are scoped, placed, and
tested. They came out of a review of
`apps/web/src/components/plsql-analysis/analysis-pagination.tsx`, which several PL/SQL
panels share but which could not be reused elsewhere: it hardcoded a feature translation
namespace, fixed its own sticky layout, bundled unrelated exports, duplicated arithmetic
between two variants, and shipped without component tests.

They supplement the React and TypeScript sections of `AGENTS.md` and the UX rules in
`docs/graphify-enterprise-ux-guidelines.md`. If they disagree, `AGENTS.md` wins.

## 1. Decide the scope before writing the component

Every new component is either **feature-local** or **shared**, and the choice should be
deliberate.

| Scope | Location | Name | May depend on |
| --- | --- | --- | --- |
| Shared primitive | `src/components/ui/` | Generic (`Pagination`, `CopyButton`) | `ui/`, `src/lib/`, third-party UI libraries |
| Feature component | `src/components/<feature>/` | Feature prefix allowed (`AnalysisImpactTable`) | Anything shared, plus its own feature |
| Pure logic | `src/lib/` (shared) or next to the feature | Verb or noun describing the calculation | Nothing React-specific |

- Start feature-local. Promote a component to `ui/` when a **second feature** needs it,
  not on speculation. Six call sites inside one feature is still feature-local.
- A component in `ui/` must not import from any `components/<feature>/` folder, read a
  feature translation namespace, or reference feature constants.
- When you promote a component, move it, rename it to drop the feature prefix, and update
  every import in the same change. Do not leave a re-export shim behind.

## 2. Keep one responsibility per module

A file should export things that change for the same reason.

- Do not mix a presentational component with a data-layer provider (for example an
  `SWRConfig` scope), a data-fetching constant (page size, limits), or a hook. Put each
  in its own module and name it for what it does.
- A name must describe the behaviour. `AnalysisPaginationScope` was really a per-mount
  request cache, and the landing page wrapped itself in it without paging anything.
- Constants that describe a request (`limit`, `offset`, page size) belong with the data
  layer or hook that sends the request, not with the UI that displays the result.

## 3. Let the caller own layout and text

Shared components should render their content and leave the surrounding context to the
caller.

- **Layout.** Do not hardcode positioning (`sticky`, `fixed`, outer margins, `z-index`,
  borders that only make sense in one page). Accept `className` and merge it with `cn()`,
  or let the caller wrap the component.
- **Text.** A component in `ui/` must not call `useTranslations("<feature>…")`. Either
  take the labels it needs as props, or read from a shared namespace (such as
  `shell.json`, or a new `common` namespace agreed under ADR 0017). Feature components
  may keep reading their own namespace.
- **Variants.** When two variants differ only in density (full and compact), prefer one
  component with a `variant` prop, or two thin components over a shared core. Do not
  copy the logic into both.

## 4. Put calculations in pure functions

If a component computes something from its props, that computation goes in a pure
function so it is written once and tested without rendering.

- Examples: page count, visible range (`from`/`to`), clamping, sorting, grouping,
  formatting rules.
- Place it next to related helpers. `src/lib/page-window.ts` is the model to follow:
  a typed pure function with its own `*.test.ts`.
- If the same three lines of arithmetic appear in two components, extract them before
  merging.

## 5. Validate and clamp inputs at the edge

Shared components receive props from many callers, so they cannot assume each caller
got the edge cases right.

- Clamp indices and counts to valid ranges (for example `page` to `0..pageCount-1`)
  inside the component or its pure helper, so a shrinking `total` cannot produce text
  such as "Showing 51–30 of 30".
- Handle empty, zero, and single-item inputs explicitly.
- Prefer props whose types make invalid states hard to express (discriminated unions over
  loose booleans such as `loading` plus `error` both being true).

## 6. Make accessibility semantics real, not decorative

- Put `aria-label` only on elements whose role supports it (interactive controls,
  landmarks, regions). A label on a plain `<li>` or `<span>` is usually ignored by
  screen readers. Use visible text, or a `sr-only` span with the decorative glyph marked
  `aria-hidden`.
- Mark the current item with `aria-current`, and make sure its control does something
  sensible when activated, or is not focusable as a button.
- Keep `aria-live` regions small and limited to text that should actually be announced.

## 7. Keep the code honest

- Do not wrap a static string in `cn()`. Use `cn()` only when merging conditional classes
  or a caller's `className`.
- Do not export something only one module uses, unless it is a deliberate public API.
- Remove props, exports, and messages that the last change made unused.

## 8. Test what you share

A component used in more than one place needs its own test file, independent of the
panels that use it.

- Pure helpers: unit tests covering boundaries (first, last, empty, out of range).
- Components: a `*.test.tsx` with React Testing Library covering rendered text, disabled
  states at the boundaries, loading and error states, keyboard activation, and the
  callbacks fired.
- Do not rely on feature panel tests to cover a shared component indirectly.

## What ESLint enforces

`apps/web/.eslintrc.json` checks part of these rules automatically:

- `components/ui/**` cannot import feature components or `next-intl` (error).
- Functions over 120 lines, files over 400 lines, cyclomatic complexity over 15, more
  than three parameters, and nesting deeper than four levels produce warnings. Test files
  are exempt from the length and parameter limits.
- `jsx-a11y/recommended` covers ARIA and interaction semantics. Three rules with
  existing violations warn instead of failing until those are fixed, and
  `label-has-associated-control` is off because it crashes in the installed plugin
  version.

The warnings exist to flag code for refactoring. Do not add new ones, and fix them in
code you are already changing. The rest of this document still depends on review.

## Review checklist

Use this when adding or changing a component that more than one module imports.

- [ ] Scope is explicit: feature-local in `components/<feature>/` or shared in
      `components/ui/`, with a name to match.
- [ ] Shared components import nothing from feature folders or feature translation
      namespaces.
- [ ] The module exports one cohesive thing; providers, constants, and hooks live
      elsewhere.
- [ ] Positioning and outer spacing are left to the caller; `className` is accepted
      where layout varies.
- [ ] Calculations live in a tested pure function, with no duplicated arithmetic between
      variants.
- [ ] Inputs are clamped and empty, zero, and boundary cases render sensibly.
- [ ] ARIA attributes sit on elements that support them; decorative glyphs are hidden.
- [ ] A dedicated test file covers the component's states and boundaries.
- [ ] `docs/ui/component-inventory.md` lists the component if it is a shared primitive.
