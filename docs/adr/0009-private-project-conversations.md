# ADR 0009: Private project conversations and soft deletion

Date: 2026-08-04

## Status

Accepted

## Context

Project documents and their evidence graph are shared, but chat history can
contain a user's questions and working context. A conversation identifier is not
an authorization capability, and creation time alone cannot describe which
conversation should resume.

## Decision

Each conversation has an immutable creator subject. Every conversation list,
read, message, rename, archive, restore, and manual purge is filtered by that
subject; inaccessible identifiers return the same `404` as unknown identifiers.
Project administrators may purge a project and its associated conversations but
do not gain access to their contents.

Active and archived lists use the stable order `updated_at DESC, id DESC` with
an opaque keyset cursor containing both values. Creating, appending a message,
renaming, archiving, and restoring advances `updated_at`. The first persisted
user question supplies a deterministic local name; no model call is made.

`DELETE /api/v1/conversations/{id}` is a reversible archive operation. Archived
conversations cannot be opened or continued until restored. They may be purged
immediately through the explicit purge endpoint and are automatically purged
30 days after `archived_at`. Active conversations have no age-based retention.
Mutations conflict while a live request lease exists.

The migration deletes all legacy conversation rows before making ownership
required. Assigning old ownerless histories to a user would violate the privacy
boundary.

## Consequences

- Opening a project resumes the owner's most recently updated active
  conversation, creating one only when none exists.
- Browser storage is only a recoverable selection hint and never an ownership
  mechanism.
- Conversation deletion is no longer immediately destructive; permanent
  deletion has a separate confirmed action.
- Clients must use the server-provided order and treat cursors as opaque.
