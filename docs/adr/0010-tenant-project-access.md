# ADR 0010: Tenant-scoped project access and sharing

- Status: Accepted
- Date: 2026-08-04

## Context

Realm roles currently make every project visible to every authenticated viewer
and grant mutations across the complete deployment. That model cannot isolate
customers in a multi-tenant service or delegate one project's administration
without granting authority over other projects.

## Decision

Projects are private and belong to one registered tenant. Signed identity claims
select the tenant and directory groups; project memberships grant Viewer,
Contributor, Manager, or Owner access. A user's effective role is the highest
direct or group grant. Owners are named users, multiple owners are allowed, and
the final owner cannot be demoted or removed.

Realm `editor` permits project creation but grants no access to other projects.
Realm `admin` is a tenant-governance role and does not grant document, evidence,
or conversation access. Membership changes and access-request decisions are
immediate and audited. Conversations remain private to their creator.

Dedicated deployments use a configured fixed tenant. Multi-tenant deployments
require an allowlisted tenant claim. Directory search uses a server-side
Keycloak service account; the browser never receives its credential.

## Consequences

- Existing projects migrate with their creator as their only Owner; prior
  organization-wide visibility is intentionally removed.
- Every project and conversation operation must resolve project access at the
  server boundary. Client capability flags are presentation hints only.
- Public links, guests, application-managed invitations, custom roles, explicit
  denies, and approval chains remain out of scope.
