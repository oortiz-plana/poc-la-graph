"""Deterministic fixture-backed analysis client for development and tests."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from app.integrations.plsql.fixtures import build_corpus, build_edges
from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencyRecord,
    PlsqlObjectRecord,
    PlsqlPathPage,
    PlsqlPathRecord,
    PlsqlSearchPage,
)
from app.models.plsql import ObjectKind, PlsqlRelationship, PlsqlResolution

TABLE_ACCESS_RELATIONSHIPS: frozenset[PlsqlRelationship] = frozenset(
    {"READS", "WRITES", "TRIGGER_ON", "VIEW_DEPENDS_ON"}
)
PATH_RELATIONSHIPS: frozenset[PlsqlRelationship] = frozenset(
    {"CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON"}
)
UNRESOLVED_RESOLUTIONS: frozenset[PlsqlResolution] = frozenset(
    {"AMBIGUOUS", "UNRESOLVED"}
)
TABLE_OR_VIEW: frozenset[ObjectKind] = frozenset({"Table", "View"})


class SyntheticPlsqlAnalysisClient:
    """Serves a fixed synthetic corpus with deterministic ordering.

    Selection is read-only and deterministic for a fixed project identifier,
    which is what API tests and the synthetic E2E overlay assert against.
    """

    def __init__(
        self,
        *,
        project_id: str,
        max_rows: int = 200,
    ) -> None:
        self._project_id = project_id
        self._max_rows = max(1, max_rows)
        self._corpus: tuple[PlsqlObjectRecord, ...] = tuple(
            sorted(
                build_corpus(project_id),
                key=lambda item: (item.qualified_name.casefold(), item.id),
            )
        )
        self._by_id = {record.id: record for record in self._corpus}
        self._edges: tuple[PlsqlDependencyRecord, ...] = tuple(
            sorted(
                build_edges(project_id, list(self._corpus)),
                key=lambda edge: (
                    edge.relationship,
                    edge.source_qualified_name.casefold(),
                    edge.target_qualified_name.casefold(),
                    edge.id,
                ),
            )
        )

    async def check_connectivity(self) -> str:
        return "synthetic"

    def _matches(
        self,
        record: PlsqlObjectRecord,
        query: str,
        kinds: Sequence[ObjectKind] | None,
    ) -> bool:
        if kinds is not None and record.kind not in kinds:
            return False
        needle = query.casefold().strip()
        if not needle:
            return True
        return needle in record.name.casefold() or (
            needle in record.qualified_name.casefold()
        )

    async def search_objects(
        self,
        *,
        query: str,
        kinds: Sequence[ObjectKind] | None,
        limit: int,
    ) -> PlsqlSearchPage:
        bounded_limit = max(1, min(limit, self._max_rows))
        matches = [
            record for record in self._corpus if self._matches(record, query, kinds)
        ]
        return PlsqlSearchPage(
            items=matches[:bounded_limit],
            truncated=len(matches) > bounded_limit,
            total=len(matches),
        )

    async def get_object(self, object_id: str) -> PlsqlObjectRecord | None:
        return self._by_id.get(object_id)

    def _dependency_page(
        self,
        edges: Sequence[PlsqlDependencyRecord],
        limit: int,
    ) -> PlsqlDependencyPage:
        bounded_limit = max(1, min(limit, self._max_rows))
        return PlsqlDependencyPage(
            items=list(edges[:bounded_limit]),
            truncated=len(edges) > bounded_limit,
            total=len(edges),
        )

    def _container_belongs(self, record: PlsqlObjectRecord, object_id: str) -> bool:
        """True when the record is the object or a member of its package."""
        if record.id == object_id:
            return True
        if record.owner is None:
            return False
        owner = self._by_id.get(object_id)
        return bool(
            owner
            and owner.kind == "Package"
            and record.owner == owner.name
            and record.schema_name == owner.schema_name
        )

    async def callers_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        matches = [
            edge
            for edge in self._edges
            if edge.relationship == "CALLS" and edge.target_id == object_id
        ]
        return self._dependency_page(matches, limit)

    async def callees_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        matches = [
            edge
            for edge in self._edges
            if edge.relationship == "CALLS" and edge.source_id == object_id
        ]
        return self._dependency_page(matches, limit)

    async def table_access_of(
        self,
        *,
        object_id: str,
        limit: int,
    ) -> PlsqlDependencyPage:
        matches: list[PlsqlDependencyRecord] = []
        for edge in self._edges:
            if edge.relationship not in TABLE_ACCESS_RELATIONSHIPS:
                continue
            source = self._by_id.get(edge.source_id)
            target = self._by_id.get(edge.target_id)
            if source is None or target is None:
                continue
            source_is_ours = self._container_belongs(source, object_id)
            target_is_ours = self._container_belongs(target, object_id)
            if source_is_ours and target.kind in TABLE_OR_VIEW:
                matches.append(edge)
            elif target_is_ours:
                matches.append(edge)
        return self._dependency_page(matches, limit)

    async def unresolved_references(
        self,
        *,
        limit: int,
    ) -> PlsqlDependencyPage:
        matches = [
            edge for edge in self._edges if edge.resolution in UNRESOLVED_RESOLUTIONS
        ]
        return self._dependency_page(matches, limit)

    async def find_paths(
        self,
        *,
        from_id: str,
        to_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlPathPage:
        """Enumerate bounded dependency paths from ``from_id`` to ``to_id``.

        Only typed dependency relationships (``CALLS | READS | WRITES |
        VIEW_DEPENDS_ON``) between objects of the corpus participate; edges
        pointing to unresolved placeholders outside the corpus are reported
        by :meth:`unresolved_references`, never traversed as if resolved.
        Results are ordered by hop count and then lexicographic node ids,
        duplicates are collapsed, and a row cap reports ``truncated``.
        """
        bounded_hops = max(1, max_hops)
        edge_by_id = {edge.id: edge for edge in self._edges}
        adjacency: dict[str, list[PlsqlDependencyRecord]] = {}
        for edge in self._edges:
            if edge.relationship not in PATH_RELATIONSHIPS:
                continue
            if edge.source_id not in self._by_id:
                continue
            if edge.target_id not in self._by_id:
                continue
            adjacency.setdefault(edge.source_id, []).append(edge)
        for out_edges in adjacency.values():
            out_edges.sort(key=lambda edge: edge.id)

        discovered: set[tuple[str, ...]] = set()

        def walk(current: str, trail: tuple[str, ...]) -> None:
            if current == to_id:
                if trail:
                    discovered.add(trail)
                return
            if len(trail) >= bounded_hops:
                return
            visited = {from_id} | {edge_by_id[edge_id].target_id for edge_id in trail}
            for edge in adjacency.get(current, ()):
                if edge.target_id in visited:
                    continue
                walk(edge.target_id, trail + (edge.id,))

        walk(from_id, ())

        def node_ids(trail: tuple[str, ...]) -> tuple[str, ...]:
            return (from_id,) + tuple(
                edge_by_id[edge_id].target_id for edge_id in trail
            )

        ordered = sorted(
            discovered, key=lambda trail: (len(trail), node_ids(trail), trail)
        )

        def path_record(trail: tuple[str, ...]) -> PlsqlPathRecord:
            digest = hashlib.sha1("\x1f".join(trail).encode("utf-8")).hexdigest()[:16]
            steps = [edge_by_id[edge_id] for edge_id in trail]
            return PlsqlPathRecord(
                id=f"path://{self._project_id}/{digest}",
                steps=steps,
                hop_count=len(steps),
            )

        bounded_limit = max(1, min(limit, self._max_rows))
        return PlsqlPathPage(
            items=[path_record(trail) for trail in ordered[:bounded_limit]],
            truncated=len(ordered) > bounded_limit,
            total=len(ordered),
        )
