"""Deterministic fixture-backed analysis client for development and tests."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Sequence

from app.integrations.plsql.fixtures import build_corpus, build_edges
from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencyRecord,
    PlsqlDependencySummaryRecord,
    PlsqlHealthCategoryRecord,
    PlsqlHealthRecord,
    PlsqlFileRecord,
    PlsqlImpactItemRecord,
    PlsqlImpactPage,
    PlsqlImpactSummaryRecord,
    PlsqlObjectRecord,
    PlsqlOverviewRecord,
    PlsqlPathPage,
    PlsqlPathRecord,
    PlsqlSearchPage,
    PlsqlSourceHighlight,
    PlsqlSourceRecord,
)
from app.integrations.plsql.source import (
    read_source_lines,
    resolve_source_file,
    source_root,
)
from app.models.plsql import (
    ImpactDirection,
    ObjectKind,
    PlsqlDependencyCategory,
    PlsqlRelationship,
    PlsqlResolution,
)

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

# Synonyms are aliases to other objects, not analyzable objects, so they are
# excluded from object search results (mirrored by the Neo4j catalog).
SEARCH_EXCLUDED_KINDS: frozenset[ObjectKind] = frozenset({"Synonym"})

DEFAULT_MAX_SOURCE_BYTES = 262_144


def _path_record(
    project_id: str,
    edge_by_id: dict[str, PlsqlDependencyRecord],
    trail: tuple[str, ...],
) -> PlsqlPathRecord:
    """Build a deterministic path record from an ordered trail of edge ids."""
    digest = hashlib.sha1("\x1f".join(trail).encode("utf-8")).hexdigest()[:16]
    steps = [edge_by_id[edge_id] for edge_id in trail]
    return PlsqlPathRecord(
        id=f"path://{project_id}/{digest}",
        steps=steps,
        hop_count=len(steps),
    )


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
        source_root: str | None = None,
        max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
    ) -> None:
        self._project_id = project_id
        self._max_rows = max(1, max_rows)
        self._source_root = source_root
        self._max_source_bytes = max(1, max_source_bytes)
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
        self._edge_by_id = {edge.id: edge for edge in self._edges}
        source_files = {
            (record.evidence.source_file_id, record.evidence.path)
            for record in self._corpus
            if record.evidence is not None
        }
        source_files.update(
            (edge.evidence.source_file_id, edge.evidence.path)
            for edge in self._edges
            if edge.evidence is not None
        )
        self._file_by_id = {file_id: path for file_id, path in sorted(source_files)}

    async def check_connectivity(self) -> str:
        return "synthetic"

    def _matches(
        self,
        record: PlsqlObjectRecord,
        query: str,
        kinds: Sequence[ObjectKind] | None,
    ) -> bool:
        if record.kind in SEARCH_EXCLUDED_KINDS:
            return False
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

    async def health(
        self,
        *,
        object_id: str | None,
        limit: int,
    ) -> PlsqlHealthRecord:
        """Return analysis-quality diagnostics grouped by category."""
        edges = await self.unresolved_references(limit=self._max_rows)

        def in_scope(edge: PlsqlDependencyRecord) -> bool:
            if object_id is None:
                return True
            source = self._by_id.get(edge.source_id)
            return source is not None and self._container_belongs(
                source, object_id
            )

        unresolved = [
            edge
            for edge in edges.items
            if edge.resolution == "UNRESOLVED" and in_scope(edge)
        ]
        ambiguous = [
            edge
            for edge in edges.items
            if edge.resolution == "AMBIGUOUS" and in_scope(edge)
        ]

        def category(
            items: list[PlsqlDependencyRecord],
        ) -> tuple[PlsqlHealthCategoryRecord, bool]:
            bounded = max(1, min(limit, self._max_rows))
            return (
                PlsqlHealthCategoryRecord(
                    count=len(items), items=items[:bounded]
                ),
                len(items) > bounded,
            )

        unresolved_record, unresolved_truncated = category(unresolved)
        ambiguous_record, ambiguous_truncated = category(ambiguous)
        empty = PlsqlHealthCategoryRecord(count=0, items=[])
        return PlsqlHealthRecord(
            total=len(unresolved) + len(ambiguous),
            unresolved=unresolved_record,
            ambiguous=ambiguous_record,
            dynamic_sql=empty,
            parse_errors=empty,
            unsupported=empty,
            truncated=unresolved_truncated or ambiguous_truncated,
        )

    async def dependencies_of(
        self,
        *,
        object_id: str,
        category: PlsqlDependencyCategory,
        limit: int,
    ) -> PlsqlDependencySummaryRecord:
        """Return per-category counts plus the selected category's page."""
        callers = await self.callers_of(object_id=object_id, limit=self._max_rows)
        callees = await self.callees_of(object_id=object_id, limit=self._max_rows)
        access = await self.table_access_of(
            object_id=object_id, limit=self._max_rows
        )
        buckets: dict[str, list[PlsqlDependencyRecord]] = {
            "callers": list(callers.items),
            "callees": list(callees.items),
            "reads": [edge for edge in access.items if edge.relationship == "READS"],
            "writes": [edge for edge in access.items if edge.relationship == "WRITES"],
            "other": [
                edge
                for edge in access.items
                if edge.relationship not in ("READS", "WRITES")
            ],
        }
        page = self._dependency_page(buckets[category], limit)
        return PlsqlDependencySummaryRecord(
            counts={
                "callers": callers.total,
                "callees": callees.total,
                "reads": len(buckets["reads"]),
                "writes": len(buckets["writes"]),
                "other": len(buckets["other"]),
            },
            items=list(page.items),
            truncated=page.truncated,
            total=page.total,
        )

    async def overview_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlOverviewRecord:
        """Return headline counts and the first direct callers of an object.

        Direct dependents are sources of typed dependency edges that reach
        the object (or one of its package members) in one hop; indirect
        dependents are the remaining distinct dependents within ``max_hops``.
        """
        record = self._by_id[object_id]
        anchors = set(self._impact_anchors(object_id))
        access = await self.table_access_of(
            object_id=object_id, limit=self._max_rows
        )
        impact = await self.impact_of(
            object_id=object_id, max_hops=max_hops, limit=self._max_rows
        )
        direct = sum(
            1
            for edge in self._edges
            if edge.relationship in PATH_RELATIONSHIPS
            and edge.target_id in anchors
            and edge.source_id in self._by_id
        )
        caller_ids = list(
            dict.fromkeys(
                edge.source_id
                for edge in self._edges
                if edge.relationship == "CALLS" and edge.target_id in anchors
            )
        )
        callee_ids = list(
            dict.fromkeys(
                edge.target_id
                for edge in self._edges
                if edge.relationship == "CALLS" and edge.source_id in anchors
            )
        )
        return PlsqlOverviewRecord(
            object=record,
            direct_dependents=direct,
            indirect_dependents=max(0, impact.total - direct),
            callers=len(caller_ids),
            callees=len(callee_ids),
            tables_accessed=len(
                {
                    edge.target_id
                    for edge in access.items
                    if edge.target_kind in TABLE_OR_VIEW
                }
            ),
            top_callers=[
                self._by_id[caller_id]
                for caller_id in caller_ids[:limit]
                if caller_id in self._by_id
            ],
        )

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

        bounded_limit = max(1, min(limit, self._max_rows))
        return PlsqlPathPage(
            items=[
                _path_record(self._project_id, edge_by_id, trail)
                for trail in ordered[:bounded_limit]
            ],
            truncated=len(ordered) > bounded_limit,
            total=len(ordered),
        )

    async def relationship_evidence(
        self, relationship_id: str
    ) -> PlsqlDependencyRecord | None:
        """Return one typed edge by opaque id, or None when unknown."""
        return self._edge_by_id.get(relationship_id)

    def _highlight(
        self,
        *,
        start_line: int | None,
        end_line: int | None,
    ) -> PlsqlSourceHighlight | None:
        if start_line is None:
            return None
        end = max(start_line, end_line or start_line)
        return PlsqlSourceHighlight(start_line=start_line, end_line=end)

    async def _load_source(
        self,
        *,
        file_id: str,
        path: str,
        start_line: int | None,
        end_line: int | None,
    ) -> PlsqlSourceRecord:
        root = source_root(self._source_root)

        def read() -> list[str]:
            resolved = resolve_source_file(root, path)
            return read_source_lines(resolved, self._max_source_bytes)

        lines = await asyncio.to_thread(read)
        return PlsqlSourceRecord(
            file=PlsqlFileRecord(file_id=file_id, path=path),
            lines=lines,
            highlight=self._highlight(start_line=start_line, end_line=end_line),
        )

    async def object_source(self, *, object_id: str) -> PlsqlSourceRecord | None:
        """Return read-only content for an object's declaration file.

        The highlight covers the object's declaration line. Returns None when
        the object is unknown or carries no source evidence.
        """
        record = self._by_id.get(object_id)
        if record is None or record.evidence is None:
            return None
        evidence = record.evidence
        return await self._load_source(
            file_id=evidence.source_file_id,
            path=evidence.path,
            start_line=evidence.start_line,
            end_line=None,
        )

    async def file_source(
        self,
        *,
        file_id: str,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> PlsqlSourceRecord | None:
        """Return read-only content for a known file id.

        ``start_line``/``end_line`` are optional request ranges echoed back as
        the highlight; returns None for unknown file ids.
        """
        path = self._file_by_id.get(file_id)
        if path is None:
            return None
        return await self._load_source(
            file_id=file_id,
            path=path,
            start_line=start_line,
            end_line=end_line,
        )

    def _impact_anchors(self, object_id: str) -> list[str]:
        """Return the node ids impact walks backwards from.

        A package impacts through all of its member routines; any other
        object impacts through itself.
        """
        record = self._by_id.get(object_id)
        if record is None:
            return []
        if record.kind != "Package":
            return [object_id]
        return sorted(
            (
                candidate.id
                for candidate in self._corpus
                if candidate.id != object_id
                and self._container_belongs(candidate, object_id)
            ),
            key=lambda item: item,
        )

    def _impact_trails(
        self,
        object_id: str,
        max_hops: int,
        relationships: frozenset[str],
        direction: ImpactDirection,
    ) -> tuple[dict[str, set[tuple[str, ...]]], dict[str, PlsqlDependencyRecord]]:
        """Traverse typed edges from the object's anchors.

        Returns shortest trails per dependent (edge-id tuples ordered
        dependent → anchor for upstream, anchor → dependent for downstream)
        plus the edge registry used to rebuild paths.
        """
        bounded_hops = max(1, max_hops)
        edge_by_id = {edge.id: edge for edge in self._edges}
        adjacency: dict[str, list[PlsqlDependencyRecord]] = {}
        for edge in self._edges:
            if edge.relationship not in relationships:
                continue
            if edge.source_id not in self._by_id or edge.target_id not in self._by_id:
                continue
            key = edge.target_id if direction == "upstream" else edge.source_id
            adjacency.setdefault(key, []).append(edge)
        for out_edges in adjacency.values():
            out_edges.sort(key=lambda edge: edge.id)

        trails: dict[str, set[tuple[str, ...]]] = {}

        def visit(
            current: str,
            seen: frozenset[str],
            chain: tuple[PlsqlDependencyRecord, ...],
        ) -> None:
            for edge in adjacency.get(current, ()):
                peer = (
                    edge.source_id
                    if direction == "upstream"
                    else edge.target_id
                )
                if peer in seen or len(chain) >= bounded_hops:
                    continue
                next_chain = chain + (edge,)
                if direction == "upstream":
                    forward = tuple(reversed(next_chain))
                    trails.setdefault(peer, set()).add(
                        tuple(step.id for step in forward)
                    )
                else:
                    trails.setdefault(peer, set()).add(
                        tuple(step.id for step in next_chain)
                    )
                visit(peer, seen | {peer}, next_chain)

        for anchor in self._impact_anchors(object_id):
            visit(anchor, frozenset({anchor}), ())
        return trails, edge_by_id

    def _impact_summary(
        self,
        trails: dict[str, set[tuple[str, ...]]],
        edge_by_id: dict[str, PlsqlDependencyRecord],
    ) -> PlsqlImpactSummaryRecord:
        direct = 0
        packages: set[tuple[str, str]] = set()
        tables_modified: set[str] = set()
        for dependent_id, trail_ids in trails.items():
            if min(len(trail) for trail in trail_ids) == 1:
                direct += 1
            dependent = self._by_id[dependent_id]
            if dependent.owner:
                packages.add((dependent.schema_name, dependent.owner))
            elif dependent.kind == "Package":
                packages.add((dependent.schema_name, dependent.name))
            for trail in trail_ids:
                for edge_id in trail:
                    edge = edge_by_id[edge_id]
                    if (
                        edge.relationship == "WRITES"
                        and edge.target_kind in TABLE_OR_VIEW
                    ):
                        tables_modified.add(edge.target_id)
        return PlsqlImpactSummaryRecord(
            direct=direct,
            indirect=max(0, len(trails) - direct),
            packages=len(packages),
            tables_modified=len(tables_modified),
        )

    async def impact_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
        direction: ImpactDirection = "upstream",
        relationships: frozenset[str] | None = None,
    ) -> PlsqlImpactPage:
        """Return bounded transitive impact with a blast-radius summary."""
        rels = (
            frozenset(relationships)
            if relationships is not None
            else PATH_RELATIONSHIPS
        )
        trails, edge_by_id = self._impact_trails(
            object_id, max_hops, rels, direction
        )
        items: list[PlsqlImpactItemRecord] = []
        for dependent_id, forward_trails in trails.items():
            dependent = self._by_id.get(dependent_id)
            if dependent is None:
                continue
            shortest = min(len(trail) for trail in forward_trails)
            ordered_paths = sorted(
                (trail for trail in forward_trails if len(trail) == shortest),
                key=lambda trail: (
                    tuple(edge_by_id[edge_id].target_id for edge_id in trail),
                    trail,
                ),
            )
            items.append(
                PlsqlImpactItemRecord(
                    id=f"impact://{self._project_id}/{dependent_id}/d{shortest}",
                    dependent=dependent,
                    distance=shortest,
                    paths=[
                        _path_record(self._project_id, edge_by_id, trail)
                        for trail in ordered_paths
                    ],
                )
            )
        items.sort(
            key=lambda item: (
                item.distance,
                item.dependent.qualified_name.casefold(),
                item.dependent.id,
            )
        )
        bounded_limit = max(1, min(limit, self._max_rows))
        return PlsqlImpactPage(
            items=items[:bounded_limit],
            truncated=len(items) > bounded_limit,
            total=len(items),
            summary=self._impact_summary(trails, edge_by_id),
        )
