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
    PlsqlImpactPage,
    PlsqlObjectRecord,
    PlsqlPathPage,
    PlsqlSearchPage,
    PlsqlSourceRecord,
)
from app.models.plsql import ObjectKind


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
    ) -> PlsqlImpactPage:
        """Return transitive dependents of a changed object within max hops.

        Each dependent item carries its shortest explaining path(s) with
        per-hop evidence; scope is computed from paths and relationship
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
