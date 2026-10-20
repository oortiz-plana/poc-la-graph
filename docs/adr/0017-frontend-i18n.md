# ADR 0017: Frontend internationalization with next-intl

- Status: accepted
- Date: 2026-10-19

## Context

Every UI string in `apps/web` was hardcoded in English and `<html lang>` was
fixed. The product works with Spanish-language content, so the interface needs
Spanish alongside English without changing URLs, Keycloak redirect URIs, or the
same-origin proxy routes.

## Decision

Use `next-intl` without locale-prefixed routing. The locale is resolved from a
`locale` cookie, then `Accept-Language`, then the default `en`. A language
switcher in the application shell sets the cookie through a server action.
Messages live in `apps/web/messages/{en,es}.json`; `en.json` types the keys
through an `AppConfig` augmentation. Only UI chrome is translated. Backend
answers, citations, source text, and PL/SQL identifiers are not.

## Consequences

Tests render through `renderWithIntl`. A catalog test enforces identical keys
across locales. Existing screens are migrated one area at a time.
