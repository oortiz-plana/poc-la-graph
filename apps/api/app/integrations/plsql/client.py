"""Domain protocol for the read-only PL/SQL analysis graph client.

The gateway exposes domain operations only. Each implementation executes a
deterministic allowlist of parameterized query paths (ADR 0012); callers never
see Cypher, the driver, or raw graph payloads.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencyRecord,
    PlsqlDependencySummaryRecord,
    PlsqlHealthRecord,
    PlsqlImpactPage,
    PlsqlObjectRecord,
    PlsqlOverviewRecord,
    PlsqlPathPage,
    PlsqlSearchPage,
    PlsqlSourceRecord,
)
from app.models.plsql import (
    ImpactDirection,
    ObjectKind,
    PlsqlDependencyCategory,
)


@runtime_checkable
class AnalysisGraphClient(Protocol):
    """Read-only domain operations over the analyzed PL/SQL graph."""

    async def check_connectivity(self) -> str:
        """Return a short connectivity status label; raises on failure."""
        ...

    async def search_objects(
        self,
        *,
        query: str,
        kinds: Sequence[ObjectKind] | None,
        limit: int,
    ) -> PlsqlSearchPage:
        """Deterministically search objects by name/qualified name."""
        ...

    async def get_object(self, object_id: str) -> PlsqlObjectRecord | None:
        """Return one object by opaque identifier, or None when unknown."""
        ...

    async def health(
        self,
        *,
        object_id: str | None,
        limit: int,
    ) -> PlsqlHealthRecord:
        """Return analysis-quality diagnostics grouped by category.

        ``object_id`` scopes the report to one routine or package; None
        reports repository-wide diagnostics.
        """
        ...

    async def dependencies_of(
        self,
        *,
        object_id: str,
        category: PlsqlDependencyCategory,
        limit: int,
    ) -> PlsqlDependencySummaryRecord:
        """Return per-category dependency counts plus the selected page.

        Categories are ``callers``/``callees`` (CALLS in/out), ``reads`` and
        ``writes`` (table edges), and ``other`` (remaining typed edges such
        as TRIGGER_ON and VIEW_DEPENDS_ON).
        """
        ...

    async def overview_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlOverviewRecord:
        """Return headline counts (dependents, callers, callees, tables) and
        the first direct callers of one object, ordered deterministically."""
        ...

    async def callers_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        """Return routines that call the given routine (incoming CALLS)."""
        ...

    async def callees_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        """Return routines called by the given routine (outgoing CALLS)."""
        ...

    async def table_access_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        """Return READS/WRITES/TRIGGER_ON/VIEW_DEPENDS_ON edges of an object."""
        ...

    async def find_paths(
        self,
        *,
        from_id: str,
        to_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlPathPage:
        """Return bounded dependency paths from one object to another.

        Traverses only typed dependency relationships
        (``CALLS | READS | WRITES | VIEW_DEPENDS_ON``) within ``max_hops``,
        ordered by hop count then lexicographic node ids, with duplicate
        paths collapsed and truncation reported when the row cap is hit.
        """
        ...

    async def unresolved_references(
        self,
        *,
        limit: int,
    ) -> PlsqlDependencyPage:
        """Return edges whose resolution is AMBIGUOUS or UNRESOLVED."""
        ...

    async def impact_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
        direction: ImpactDirection = "upstream",
        relationships: frozenset[str] | None = None,
    ) -> PlsqlImpactPage:
        """Return bounded transitive impact with a blast-radius summary.

        ``direction`` selects dependents (upstream: who is affected when this
        object changes) or dependencies (downstream: what this object affects).
        ``relationships`` restricts the traversed edge types; each item carries
        its shortest explaining path(s) with per-hop evidence, and ``summary``
        reports direct/indirect counts, distinct packages, and tables modified
        on the traversed paths. Scope is computed from paths and relationship
        types, never a stored severity.
        """
        ...

    async def relationship_evidence(
        self, relationship_id: str
    ) -> PlsqlDependencyRecord | None:
        """Return one typed edge by opaque id, or None when unknown."""
        ...

    async def object_source(self, *, object_id: str) -> PlsqlSourceRecord | None:
        """Return read-only content for an object's declaration file.

        None when the object is unknown or carries no source evidence.
        """
        ...

    async def file_source(
        self,
        *,
        file_id: str,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> PlsqlSourceRecord | None:
        """Return read-only content for a known file id, or None when unknown."""
        ...
