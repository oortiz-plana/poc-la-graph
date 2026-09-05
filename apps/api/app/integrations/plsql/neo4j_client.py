"""Read-only Neo4j-backed analysis client (PL/SQL console real mode).

Implements the :class:`AnalysisGraphClient` protocol over a Bolt driver for
the graph persisted by `plsqlgraph` (see
``docs/architecture/plsql-analysis-console.md`` §5 for the consumed graph
model). All Cypher lives in the allowlisted catalog
(:mod:`app.integrations.plsql.catalog`); this client executes catalog entries
with named parameters only, maps rows onto internal records, derives
deterministic pages and paths client-side (mirroring the synthetic adapter's
semantics and ordering), and normalizes driver failures into the
:mod:`app.integrations.plsql.errors` taxonomy. Sessions are read-only when
``plsql_neo4j_read_only`` is set (the default).

Schema note: read the schema-confirmation note in the catalog module. Until a
first real graph is connected, catalog assumptions may surface as empty
results, missing declaration evidence, or a mapping gap; the integration
tests in ``apps/api/tests/plsql/test_plsql_neo4j_api.py`` are the alignment
harness against a real ``plsqlgraph`` instance.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
from collections.abc import Mapping, Sequence
from typing import Any, Final, cast

import neo4j
from neo4j import GraphDatabase

from app.integrations.plsql.catalog import (
    COUNT_SEARCH_OBJECTS,
    KIND_LABELS,
    OBJECT_BY_QUALIFIED_NAME,
    PROJECT_EDGES,
    RESOLUTIONS,
    SCHEMA_EDGE_END_OFFSET,
    SCHEMA_EDGE_SOURCE_FILE_ID,
    SCHEMA_EDGE_START_COLUMN,
    SCHEMA_EDGE_START_LINE,
    SCHEMA_EDGE_START_OFFSET,
    SCHEMA_FILE_PATH,
    SCHEMA_NODE_NAME,
    SCHEMA_NODE_QUALIFIED_NAME,
    SEARCH_OBJECTS,
    SOURCE_FILES,
    TABLE_ACCESS_RELATIONSHIPS,
    UNRESOLVED_RESOLUTIONS,
)
from app.integrations.plsql.errors import (
    PlsqlConfigurationError,
    PlsqlLimitExceeded,
    PlsqlObjectNotFound,
    PlsqlTimeout,
    PlsqlUnavailable,
)
from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencyRecord,
    PlsqlEvidence,
    PlsqlFileRecord,
    PlsqlImpactItemRecord,
    PlsqlImpactPage,
    PlsqlObjectRecord,
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
from app.models.plsql import ObjectKind, PlsqlRelationship, PlsqlResolution

CONNECTIVITY_QUERY: Final = "RETURN 1 AS ok"
MAX_EDGE_ROWS: Final = 100_000

_TYPED_DEPENDENCIES: Final[frozenset[str]] = frozenset(
    {"CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON"}
)
_TABLE_OR_VIEW: Final[frozenset[str]] = frozenset({"Table", "View"})


def _b64e(value: str) -> str:
    """URL-safe base64 without padding (safe inside query parameters)."""
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _b64d(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")


def object_id(project_id: str, qualified_name: str) -> str:
    """Stable opaque identifier for a graph object (round-trippable)."""
    return f"plsql://{project_id}/o/{_b64e(qualified_name)}"


def qualified_name_from_object_id(object_id: str) -> str | None:
    """Reverse :func:`object_id`; ``None`` when the identifier is foreign."""
    if "/o/" not in object_id:
        return None
    _, encoded = object_id.rsplit("/o/", 1)
    try:
        return _b64d(encoded)
    except (ValueError, TypeError):
        return None


def edge_id(
    project_id: str,
    relationship: str,
    source_qualified_name: str,
    target_qualified_name: str,
) -> str:
    """Stable opaque identifier for one typed edge (round-trippable)."""
    payload = "\x1f".join((relationship, source_qualified_name, target_qualified_name))
    return f"edge://{project_id}/e/{_b64e(payload)}"


def _edge_parts(edge_id: str) -> tuple[str, str, str] | None:
    """Reverse :func:`edge_id`; ``None`` when the identifier is foreign."""
    if "/e/" not in edge_id:
        return None
    _, encoded = edge_id.rsplit("/e/", 1)
    try:
        payload = _b64d(encoded)
    except (ValueError, TypeError):
        return None
    parts = payload.split("\x1f")
    if len(parts) != 3:
        return None
    return cast(tuple[str, str, str], tuple(parts))


def _schema_of(qualified_name: str) -> str:
    return qualified_name.split(".", 1)[0]


def _owner_of(qualified_name: str) -> str | None:
    """Package owner for member routines (``SCHEMA.PACKAGE.MEMBER``)."""
    parts = qualified_name.split(".")
    return parts[1] if len(parts) >= 3 else None


def _kind_from_labels(labels: Sequence[str]) -> ObjectKind | None:
    for label in labels:
        if label in KIND_LABELS:
            return cast(ObjectKind, label)
    return None


def _node_value(node: Any, key: str, default: Any = None) -> Any:
    get = getattr(node, "get", None)
    if callable(get):
        return get(key, default)
    if isinstance(node, dict):
        return node.get(key, default)
    return default


def _str_or_none(value: object) -> str | None:
    return None if value is None else str(value)


def _int_or_none(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class Neo4jPlsqlAnalysisClient:
    """Bolt-backed implementation of the read-only analysis protocol."""

    def __init__(
        self,
        *,
        project_id: str,
        uri: str,
        user: str | None = None,
        password: str | None = None,
        read_only: bool = True,
        query_timeout_seconds: float = 10.0,
        max_rows: int = 200,
        max_hops: int = 5,
        source_root: str | None = None,
        max_source_bytes: int = 262_144,
    ) -> None:
        if not uri:
            raise PlsqlConfigurationError(
                "PLSQL_NEO4J_URI is required when PLSQL_ADAPTER=neo4j."
            )
        self._project_id = project_id
        self._read_only = read_only
        self._timeout = query_timeout_seconds
        self._max_rows = max(1, max_rows)
        self._max_hops = max(1, max_hops)
        self._source_root = source_root
        self._max_source_bytes = max(1, max_source_bytes)
        auth = (user, password) if user is not None and password is not None else None
        try:
            self._driver: neo4j.Driver = GraphDatabase.driver(
                uri,
                auth=auth,
                connection_timeout=query_timeout_seconds,
                max_connection_lifetime=30 * 60,
            )
        except neo4j.exceptions.ConfigurationError as exc:
            raise PlsqlConfigurationError(
                "The Neo4j driver rejected the analysis configuration."
            ) from exc
        self._edge_cache: list[PlsqlDependencyRecord] | None = None
        self._file_map_cache: dict[str, str] | None = None
        self._object_cache: dict[str, PlsqlObjectRecord | None] = {}

    def close(self) -> None:
        """Close the Bolt driver (called on application shutdown)."""
        if self._driver is not None:
            self._driver.close()
            self._driver = cast(Any, None)

    # --- driver plumbing ---------------------------------------------------

    def _read_session(self, query: str, **params: object) -> list[dict[str, Any]]:
        with self._driver.session(
            default_access_mode=(
                neo4j.READ_ACCESS if self._read_only else neo4j.WRITE_ACCESS
            )
        ) as session:
            return session.execute_read(lambda tx: list(tx.run(query, **params).data()))

    def _map_driver_error(self, exc: BaseException) -> PlsqlUnavailable:
        """Normalize a driver failure into the analysis error taxonomy."""
        code = str(getattr(exc, "code", "") or "")
        if isinstance(exc, neo4j.exceptions.AuthError):
            return PlsqlConfigurationError(
                "The Neo4j analysis credentials were rejected."
            )
        if isinstance(exc, neo4j.exceptions.ConfigurationError):
            return PlsqlConfigurationError(
                "The Neo4j analysis connection is misconfigured."
            )
        if isinstance(
            exc, (neo4j.exceptions.ServiceUnavailable, neo4j.exceptions.SessionExpired)
        ):
            return PlsqlUnavailable("The Neo4j analysis backend is unavailable.")
        if "timeout" in code.casefold() or "terminated" in code.casefold():
            return PlsqlTimeout("The Neo4j analysis query exceeded its deadline.")
        return PlsqlUnavailable("The Neo4j analysis query failed.")

    async def _execute(self, query: str, **params: object) -> list[dict[str, Any]]:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._read_session, query, **params),
                timeout=self._timeout + 1.0,
            )
        except TimeoutError as exc:
            raise PlsqlTimeout(
                "The Neo4j analysis query exceeded its deadline."
            ) from exc
        except neo4j.exceptions.DriverError as exc:
            raise self._map_driver_error(exc) from exc

    async def check_connectivity(self) -> str:
        await self._execute(CONNECTIVITY_QUERY)
        return "connected"

    # --- graph projections -------------------------------------------------

    async def _file_map(self) -> dict[str, str]:
        """Map graph file ids to project-relative paths (lazy, cached)."""
        if self._file_map_cache is not None:
            return self._file_map_cache
        rows = await self._execute(SOURCE_FILES, projectId=self._project_id)
        mapping: dict[str, str] = {}
        for row in rows:
            path = row.get(SCHEMA_FILE_PATH)
            file_key = row.get("fileId")
            if path and file_key:
                mapping[str(file_key)] = str(path)
        self._file_map_cache = mapping
        return mapping

    async def _resolve_path(self, file_id: str | None) -> str | None:
        """Resolve a graph file id to a project-relative path, best effort."""
        if file_id is None:
            return None
        mapping = await self._file_map()
        if file_id in mapping:
            return mapping[file_id]
        prefix = f"file://{self._project_id}/"
        if file_id.startswith(prefix):
            return file_id[len(prefix) :]
        return None

    def _evidence(
        self,
        *,
        file_id: str | None,
        path: str | None,
        start_line: int | None,
        start_column: int | None,
        start_offset: int | None,
        end_offset: int | None,
    ) -> PlsqlEvidence | None:
        if not file_id or not path:
            return None
        return PlsqlEvidence(
            source_file_id=file_id,
            path=path,
            start_line=start_line,
            start_column=start_column,
            start_offset=start_offset,
            end_offset=end_offset,
        )

    def _object_from_node(
        self, node: Any, labels: Sequence[str]
    ) -> PlsqlObjectRecord | None:
        kind = _kind_from_labels(labels)
        raw_qualified = _node_value(node, SCHEMA_NODE_QUALIFIED_NAME)
        if kind is None or not raw_qualified:
            return None
        qualified = str(raw_qualified)
        name = _node_value(node, SCHEMA_NODE_NAME)
        if not name:
            name = qualified.rsplit(".", 1)[-1]
        return PlsqlObjectRecord(
            id=object_id(self._project_id, qualified),
            kind=kind,
            name=str(name),
            schema_name=_schema_of(qualified),
            qualified_name=qualified,
            project_id=self._project_id,
            owner=_owner_of(qualified),
            evidence=None,
        )

    def _dependency_from_row(
        self, row: Mapping[str, Any], file_paths: Mapping[str, str]
    ) -> PlsqlDependencyRecord | None:
        """Map one catalog edge row onto a dependency record (pure)."""
        relationship = row.get("relationship")
        resolution = row.get("resolution") or "EXACT"
        source_qn = row.get("sourceQualifiedName")
        target_qn = row.get("targetQualifiedName")
        if (
            relationship not in _TYPED_DEPENDENCIES | {"TRIGGER_ON"}
            or resolution not in RESOLUTIONS
            or not source_qn
            or not target_qn
        ):
            return None
        source_kind = _kind_from_labels(row.get("sourceLabels") or ())
        target_kind = _kind_from_labels(row.get("targetLabels") or ())
        if source_kind is None or target_kind is None:
            return None
        source_qn_s = str(source_qn)
        target_qn_s = str(target_qn)
        source_name = row.get("sourceName") or source_qn_s.rsplit(".", 1)[-1]
        target_name = row.get("targetName") or target_qn_s.rsplit(".", 1)[-1]
        file_id = _str_or_none(row.get(SCHEMA_EDGE_SOURCE_FILE_ID))
        path = self._resolve_path_sync(file_id, file_paths)
        evidence = self._evidence(
            file_id=file_id,
            path=path,
            start_line=_int_or_none(row.get(SCHEMA_EDGE_START_LINE)),
            start_column=_int_or_none(row.get(SCHEMA_EDGE_START_COLUMN)),
            start_offset=_int_or_none(row.get(SCHEMA_EDGE_START_OFFSET)),
            end_offset=_int_or_none(row.get(SCHEMA_EDGE_END_OFFSET)),
        )
        return PlsqlDependencyRecord(
            id=edge_id(
                self._project_id,
                str(relationship),
                source_qn_s,
                target_qn_s,
            ),
            relationship=cast(PlsqlRelationship, relationship),
            resolution=cast(PlsqlResolution, resolution),
            source_id=object_id(self._project_id, source_qn_s),
            source_kind=source_kind,
            source_name=str(source_name),
            source_qualified_name=source_qn_s,
            target_id=object_id(self._project_id, target_qn_s),
            target_kind=target_kind,
            target_name=str(target_name),
            target_qualified_name=target_qn_s,
            evidence=evidence,
        )

    @staticmethod
    def _resolve_path_sync(
        file_id: str | None, file_paths: Mapping[str, str]
    ) -> str | None:
        if not file_id:
            return None
        if file_id in file_paths:
            return file_paths[file_id]
        if "/" in file_id:
            # Accept graph file ids that embed the path (file://project/path).
            marker = "file://"
            if file_id.startswith(marker) and marker in file_id:
                return file_id.split(marker, 1)[1].split("/", 1)[1]
        return None

    async def _edges(self) -> list[PlsqlDependencyRecord]:
        """Fetch and cache the project's typed edges once (deterministic)."""
        if self._edge_cache is not None:
            return self._edge_cache
        file_paths = await self._file_map()
        rows = await self._execute(
            PROJECT_EDGES,
            projectId=self._project_id,
            relationships=list(TABLE_ACCESS_RELATIONSHIPS | {"CALLS"}),
            limit=MAX_EDGE_ROWS,
        )
        if len(rows) >= MAX_EDGE_ROWS:
            raise PlsqlLimitExceeded(
                "The analyzed project exposes more edges than the gateway bound."
            )
        edges: list[PlsqlDependencyRecord] = []
        for row in rows:
            edge = self._dependency_from_row(row, file_paths)
            if edge is not None:
                edges.append(edge)
        edges.sort(
            key=lambda edge: (
                edge.relationship,
                edge.source_qualified_name.casefold(),
                edge.target_qualified_name.casefold(),
                edge.id,
            )
        )
        self._edge_cache = edges
        return edges

    async def get_object(self, object_id: str) -> PlsqlObjectRecord | None:
        """Return one object by opaque identifier, or None when unknown."""
        if object_id in self._object_cache:
            return self._object_cache[object_id]
        qualified_name = qualified_name_from_object_id(object_id)
        record: PlsqlObjectRecord | None = None
        if qualified_name is not None:
            rows = await self._execute(
                OBJECT_BY_QUALIFIED_NAME,
                projectId=self._project_id,
                qualifiedName=qualified_name,
            )
            if rows:
                record = self._object_from_node(
                    rows[0].get("n"), rows[0].get("nodeLabels") or ()
                )
        self._object_cache[object_id] = record
        return record

    async def _require_object(self, object_id: str) -> PlsqlObjectRecord:
        record = await self.get_object(object_id)
        if record is None:
            raise PlsqlObjectNotFound("The requested PL/SQL object was not found.")
        return record

    # --- object search -----------------------------------------------------

    async def search_objects(
        self,
        *,
        query: str,
        kinds: Sequence[ObjectKind] | None,
        limit: int,
    ) -> PlsqlSearchPage:
        bounded = max(1, min(limit, self._max_rows))
        needle = query.casefold().strip()
        kind_list = list(kinds or ())
        rows = await self._execute(
            SEARCH_OBJECTS,
            projectId=self._project_id,
            needle=needle,
            kinds=kind_list,
            limit=bounded + 1,
        )
        total_rows = await self._execute(
            COUNT_SEARCH_OBJECTS,
            projectId=self._project_id,
            needle=needle,
            kinds=kind_list,
        )
        total = int(total_rows[0]["total"]) if total_rows else 0
        items: list[PlsqlObjectRecord] = []
        for row in rows[:bounded]:
            record = self._object_from_node(row.get("n"), row.get("nodeLabels") or ())
            if record is not None:
                items.append(record)
        return PlsqlSearchPage(
            items=items,
            truncated=total > bounded,
            total=total,
        )

    # --- dependency lists --------------------------------------------------

    def _dependency_page(
        self, edges: Sequence[PlsqlDependencyRecord], limit: int
    ) -> PlsqlDependencyPage:
        bounded = max(1, min(limit, self._max_rows))
        return PlsqlDependencyPage(
            items=list(edges[:bounded]),
            truncated=len(edges) > bounded,
            total=len(edges),
        )

    @staticmethod
    def _is_or_member(qualified_name: str, container_qualified_name: str) -> bool:
        """True when ``qualified_name`` is the container or one of its members."""
        return qualified_name == container_qualified_name or qualified_name.startswith(
            container_qualified_name + "."
        )

    async def callers_of(self, *, object_id: str, limit: int) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        edges = await self._edges()
        matches = [
            edge
            for edge in edges
            if edge.relationship == "CALLS"
            and edge.target_qualified_name == record.qualified_name
        ]
        return self._dependency_page(matches, limit)

    async def callees_of(self, *, object_id: str, limit: int) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        edges = await self._edges()
        matches = [
            edge
            for edge in edges
            if edge.relationship == "CALLS"
            and edge.source_qualified_name == record.qualified_name
        ]
        return self._dependency_page(matches, limit)

    async def table_access_of(
        self, *, object_id: str, limit: int
    ) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        edges = await self._edges()
        matches: list[PlsqlDependencyRecord] = []
        for edge in edges:
            if edge.relationship not in TABLE_ACCESS_RELATIONSHIPS:
                continue
            source_is_ours = self._is_or_member(
                edge.source_qualified_name, record.qualified_name
            )
            target_is_ours = self._is_or_member(
                edge.target_qualified_name, record.qualified_name
            )
            if source_is_ours and edge.target_kind in _TABLE_OR_VIEW:
                matches.append(edge)
            elif target_is_ours:
                matches.append(edge)
        return self._dependency_page(matches, limit)

    async def unresolved_references(self, *, limit: int) -> PlsqlDependencyPage:
        edges = await self._edges()
        matches = [edge for edge in edges if edge.resolution in UNRESOLVED_RESOLUTIONS]
        return self._dependency_page(matches, limit)

    async def relationship_evidence(
        self, relationship_id: str
    ) -> PlsqlDependencyRecord | None:
        parts = _edge_parts(relationship_id)
        if parts is None:
            return None
        relationship, _, _ = parts
        if relationship not in _TYPED_DEPENDENCIES | {"TRIGGER_ON"}:
            return None
        edges = await self._edges()
        for edge in edges:
            if edge.id == relationship_id:
                return edge
        return None

    # --- source ------------------------------------------------------------

    async def object_source(self, *, object_id: str) -> PlsqlSourceRecord | None:
        """Return the declaration file of an object when evidence is present.

        Declaration coordinates are read from the object node's optional
        source properties (see the catalog schema note) and resolved against
        the graph source-file map; objects without resolvable evidence return
        ``None`` (the router answers ``analysis_not_found``).
        """
        record = await self._require_object(object_id)
        qualified_name = record.qualified_name
        rows = await self._execute(
            OBJECT_BY_QUALIFIED_NAME,
            projectId=self._project_id,
            qualifiedName=qualified_name,
        )
        if not rows:
            return None
        node = rows[0].get("n")
        file_id = _str_or_none(_node_value(node, SCHEMA_EDGE_SOURCE_FILE_ID))
        if file_id is None:
            return None
        path = await self._resolve_path(file_id)
        if path is None:
            return None
        evidence = self._evidence(
            file_id=file_id,
            path=path,
            start_line=_int_or_none(_node_value(node, SCHEMA_EDGE_START_LINE)),
            start_column=_int_or_none(_node_value(node, SCHEMA_EDGE_START_COLUMN)),
            start_offset=_int_or_none(_node_value(node, SCHEMA_EDGE_START_OFFSET)),
            end_offset=_int_or_none(_node_value(node, SCHEMA_EDGE_END_OFFSET)),
        )
        if evidence is None:
            return None
        return await self._load_source(
            file_id=file_id,
            path=path,
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
        path = await self._resolve_path(file_id)
        if path is None:
            return None
        return await self._load_source(
            file_id=file_id,
            path=path,
            start_line=start_line,
            end_line=end_line,
        )

    async def _load_source(
        self,
        *,
        file_id: str,
        path: str,
        start_line: int | None,
        end_line: int | None,
    ) -> PlsqlSourceRecord:
        root = source_root(self._source_root)
        resolved = resolve_source_file(root, path)
        lines = await asyncio.to_thread(
            read_source_lines, resolved, self._max_source_bytes
        )
        highlight = None
        if start_line is not None:
            end = max(start_line, end_line or start_line)
            highlight = PlsqlSourceHighlight(start_line=start_line, end_line=end)
        return PlsqlSourceRecord(
            file=PlsqlFileRecord(file_id=file_id, path=path),
            lines=lines,
            highlight=highlight,
        )

    # --- paths and impact (deterministic, bounded) --------------------------

    @staticmethod
    def _path_id(project_id: str, trail: tuple[str, ...]) -> str:
        digest = hashlib.sha1("\x1f".join(trail).encode("utf-8")).hexdigest()[:16]
        return f"path://{project_id}/{digest}"

    async def find_paths(
        self,
        *,
        from_id: str,
        to_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlPathPage:
        source = await self._require_object(from_id)
        target = await self._require_object(to_id)
        edges = await self._edges()
        bounded_hops = max(1, min(max_hops, self._max_hops))

        adjacency: dict[str, list[PlsqlDependencyRecord]] = {}
        for edge in edges:
            if edge.relationship not in _TYPED_DEPENDENCIES:
                continue
            adjacency.setdefault(edge.source_qualified_name, []).append(edge)
        for out in adjacency.values():
            out.sort(key=lambda edge: edge.id)

        discovered: set[tuple[str, ...]] = set()

        def walk(
            current: str,
            trail: tuple[str, ...],
            visited: frozenset[str],
        ) -> None:
            if current == target.qualified_name:
                if trail:
                    discovered.add(trail)
                return
            if len(trail) >= bounded_hops:
                return
            for edge in adjacency.get(current, ()):
                if edge.target_qualified_name in visited:
                    continue
                walk(
                    edge.target_qualified_name,
                    trail + (edge.id,),
                    visited | {edge.target_qualified_name},
                )

        walk(source.qualified_name, (), frozenset({source.qualified_name}))

        edge_by_id = {edge.id: edge for edge in edges}
        ordered = sorted(
            discovered,
            key=lambda trail: (
                len(trail),
                tuple(edge_by_id[eid].target_qualified_name for eid in trail),
                trail,
            ),
        )
        records = [
            PlsqlPathRecord(
                id=self._path_id(self._project_id, trail),
                steps=[edge_by_id[eid] for eid in trail],
                hop_count=len(trail),
            )
            for trail in ordered
        ]
        bounded = max(1, min(limit, self._max_rows))
        return PlsqlPathPage(
            items=records[:bounded],
            truncated=len(records) > bounded,
            total=len(records),
        )

    async def impact_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlImpactPage:
        changed = await self._require_object(object_id)
        edges = await self._edges()
        bounded_hops = max(1, min(max_hops, self._max_hops))

        # A package impacts through its member routines when the graph keeps
        # edges on the members; otherwise the package node is the anchor.
        anchors: list[str]
        if changed.kind == "Package":
            prefix = f"{changed.qualified_name}."
            members = sorted(
                {
                    edge.source_qualified_name
                    for edge in edges
                    if edge.source_qualified_name.startswith(prefix)
                    and _owner_of(edge.source_qualified_name) == changed.name
                }
                | {
                    edge.target_qualified_name
                    for edge in edges
                    if edge.target_qualified_name.startswith(prefix)
                    and _owner_of(edge.target_qualified_name) == changed.name
                }
            )
            anchors = members or [changed.qualified_name]
        else:
            anchors = [changed.qualified_name]

        reverse: dict[str, list[PlsqlDependencyRecord]] = {}
        for edge in edges:
            if edge.relationship not in _TYPED_DEPENDENCIES:
                continue
            reverse.setdefault(edge.target_qualified_name, []).append(edge)
        for in_edges in reverse.values():
            in_edges.sort(key=lambda edge: edge.id)

        edge_by_id = {edge.id: edge for edge in edges}
        trails_by_dependent: dict[str, set[tuple[str, ...]]] = {}

        def visit(
            current: str,
            seen: frozenset[str],
            backward: tuple[PlsqlDependencyRecord, ...],
        ) -> None:
            for edge in reverse.get(current, ()):
                if edge.source_qualified_name in seen:
                    continue
                if len(backward) >= bounded_hops:
                    continue
                chain = backward + (edge,)
                forward = tuple(reversed(chain))
                trails_by_dependent.setdefault(edge.source_qualified_name, set()).add(
                    tuple(forward_edge.id for forward_edge in forward)
                )
                visit(
                    edge.source_qualified_name,
                    seen | {edge.source_qualified_name},
                    chain,
                )

        for anchor in anchors:
            visit(anchor, frozenset({anchor}), ())

        items: list[PlsqlImpactItemRecord] = []
        for dependent_qn, forward_trails in trails_by_dependent.items():
            if dependent_qn == changed.qualified_name:
                continue
            dependent = await self.get_object(object_id(self._project_id, dependent_qn))
            if dependent is None:
                continue
            shortest = min(len(trail) for trail in forward_trails)
            shortest_trails = sorted(
                (trail for trail in forward_trails if len(trail) == shortest),
                key=lambda trail: (
                    tuple(edge_by_id[eid].target_qualified_name for eid in trail),
                    trail,
                ),
            )
            items.append(
                PlsqlImpactItemRecord(
                    id=f"impact://{self._project_id}/{dependent.id}/d{shortest}",
                    dependent=dependent,
                    distance=shortest,
                    paths=[
                        PlsqlPathRecord(
                            id=self._path_id(self._project_id, trail),
                            steps=[edge_by_id[eid] for eid in trail],
                            hop_count=len(trail),
                        )
                        for trail in shortest_trails
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
        bounded = max(1, min(limit, self._max_rows))
        return PlsqlImpactPage(
            items=items[:bounded],
            truncated=len(items) > bounded,
            total=len(items),
        )
