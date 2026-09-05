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

Every endpoint fetches only the rows it needs: dependency lists run a
targeted select (``LIMIT page + 1``) plus a count twin, and path/impact
traversals expand one bounded frontier per round. The traversal budget is the
``plsql_max_traversal_edges`` Settings parameter (passed as
``max_traversal_edges``); exceeding it raises
:class:`app.integrations.plsql.errors.PlsqlLimitExceeded`, never a
whole-project edge load.

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
    COUNT_EDGE_CALLEES,
    COUNT_EDGE_CALLERS,
    COUNT_EDGE_TABLE_ACCESS,
    COUNT_EDGE_UNRESOLVED,
    COUNT_SEARCH_OBJECTS,
    EDGE_BY_TRIPLE,
    EDGE_CALLEES,
    EDGE_CALLERS,
    EDGE_INCOMING,
    EDGE_MEMBER_ENDPOINTS,
    EDGE_OUTGOING,
    EDGE_TABLE_ACCESS,
    EDGE_UNRESOLVED,
    KIND_LABELS,
    OBJECT_BY_QUALIFIED_NAME,
    PATH_RELATIONSHIPS,
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
    PlsqlError,
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

_TABLE_OR_VIEW: Final[frozenset[str]] = frozenset({"Table", "View"})
_TRIGGER_AWARE_RELATIONSHIPS: Final[frozenset[str]] = PATH_RELATIONSHIPS | {
    "TRIGGER_ON"
}


def _b64e(value: str) -> str:
    """URL-safe base64 without padding (safe inside query parameters)."""
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _b64d(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")


def object_id(project_id: str, qualified_name: str) -> str:
    """Stable opaque identifier for a graph object (round-trippable)."""
    return f"plsql://{project_id}/o/{_b64e(qualified_name)}"


# Module alias so methods that take an ``object_id`` parameter can still call
# the factory: the parameter shadows the module function name.
make_object_id = object_id


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
        return int(str(value))
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
        max_traversal_edges: int = 20_000,
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
        self._max_traversal_edges = max(1, max_traversal_edges)
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
        self._file_map_cache: dict[str, str] | None = None
        self._object_cache: dict[str, PlsqlObjectRecord | None] = {}

    def close(self) -> None:
        """Close the Bolt driver (called on application shutdown)."""
        if self._driver is not None:
            self._driver.close()
            self._driver = cast(Any, None)

    # --- driver plumbing ---------------------------------------------------

    def _read_session(self, query: str, **params: object) -> list[dict[str, Any]]:
        parameters: dict[str, Any] = dict(params)

        @neo4j.unit_of_work(timeout=self._timeout)
        def _run(tx: neo4j.ManagedTransaction) -> list[dict[str, Any]]:
            return list(tx.run(query, **parameters).data())

        with self._driver.session(
            default_access_mode=(
                neo4j.READ_ACCESS if self._read_only else neo4j.WRITE_ACCESS
            )
        ) as session:
            return session.execute_read(_run)

    def _map_driver_error(self, exc: BaseException) -> PlsqlError:
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
            # The transaction carries its own server-side ``timeout`` (set in
            # ``_read_session``), so the server itself terminates a slow query
            # and the blocking thread returns promptly. ``asyncio.wait_for``
            # is only a client-side backstop for a server that ignores it;
            # it cannot interrupt the blocking thread on its own.
            return await asyncio.wait_for(
                asyncio.to_thread(self._read_session, query, **params),
                timeout=self._timeout + 1.0,
            )
        except TimeoutError as exc:
            raise PlsqlTimeout(
                "The Neo4j analysis query exceeded its deadline."
            ) from exc
        except neo4j.exceptions.GqlError as exc:
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
        self,
        node: Any,
        labels: Sequence[str],
        file_paths: Mapping[str, str],
    ) -> PlsqlObjectRecord | None:
        kind = _kind_from_labels(labels)
        raw_qualified = _node_value(node, SCHEMA_NODE_QUALIFIED_NAME)
        if kind is None or not raw_qualified:
            return None
        qualified = str(raw_qualified)
        name = _node_value(node, SCHEMA_NODE_NAME)
        if not name:
            name = qualified.rsplit(".", 1)[-1]
        file_id = _str_or_none(_node_value(node, SCHEMA_EDGE_SOURCE_FILE_ID))
        path = self._resolve_path_sync(file_id, file_paths)
        evidence = self._evidence(
            file_id=file_id,
            path=path,
            start_line=_int_or_none(_node_value(node, SCHEMA_EDGE_START_LINE)),
            start_column=_int_or_none(_node_value(node, SCHEMA_EDGE_START_COLUMN)),
            start_offset=_int_or_none(_node_value(node, SCHEMA_EDGE_START_OFFSET)),
            end_offset=_int_or_none(_node_value(node, SCHEMA_EDGE_END_OFFSET)),
        )
        return PlsqlObjectRecord(
            id=object_id(self._project_id, qualified),
            kind=kind,
            name=str(name),
            schema_name=_schema_of(qualified),
            qualified_name=qualified,
            project_id=self._project_id,
            owner=_owner_of(qualified),
            evidence=evidence,
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
            relationship not in _TRIGGER_AWARE_RELATIONSHIPS
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

    async def _dependency_page(
        self,
        *,
        query: str,
        count_query: str,
        limit: int,
        **params: object,
    ) -> PlsqlDependencyPage:
        """Run a targeted edge select (page + 1) plus its count twin.

        Ordering comes from the catalog's deterministic ``ORDER BY``; the
        count query shares every filter so ``total`` matches mappable rows.
        """
        bounded = max(1, min(limit, self._max_rows))
        file_paths = await self._file_map()
        rows = await self._execute(query, limit=bounded + 1, **params)
        items = [
            mapped
            for row in rows
            if (mapped := self._dependency_from_row(row, file_paths)) is not None
        ]
        total = int((await self._execute(count_query, **params))[0]["total"])
        return PlsqlDependencyPage(
            items=items[:bounded],
            truncated=len(items) > bounded,
            total=total,
        )

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
                file_paths = await self._file_map()
                record = self._object_from_node(
                    rows[0].get("n"), rows[0].get("nodeLabels") or (), file_paths
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
        file_paths = await self._file_map()
        items: list[PlsqlObjectRecord] = []
        for row in rows[:bounded]:
            record = self._object_from_node(
                row.get("n"), row.get("nodeLabels") or (), file_paths
            )
            if record is not None:
                items.append(record)
        return PlsqlSearchPage(
            items=items,
            truncated=total > bounded,
            total=total,
        )

    # --- dependency lists --------------------------------------------------

    async def callers_of(self, *, object_id: str, limit: int) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=EDGE_CALLERS,
            count_query=COUNT_EDGE_CALLERS,
            limit=limit,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            resolutions=list(RESOLUTIONS),
        )

    async def callees_of(self, *, object_id: str, limit: int) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=EDGE_CALLEES,
            count_query=COUNT_EDGE_CALLEES,
            limit=limit,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            resolutions=list(RESOLUTIONS),
        )

    async def table_access_of(
        self, *, object_id: str, limit: int
    ) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=EDGE_TABLE_ACCESS,
            count_query=COUNT_EDGE_TABLE_ACCESS,
            limit=limit,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            memberPrefix=f"{record.qualified_name}.",
            relationships=list(TABLE_ACCESS_RELATIONSHIPS),
            tableKinds=sorted(_TABLE_OR_VIEW),
            resolutions=list(RESOLUTIONS),
        )

    async def unresolved_references(self, *, limit: int) -> PlsqlDependencyPage:
        return await self._dependency_page(
            query=EDGE_UNRESOLVED,
            count_query=COUNT_EDGE_UNRESOLVED,
            limit=limit,
            projectId=self._project_id,
            relationships=list(TABLE_ACCESS_RELATIONSHIPS | {"CALLS"}),
            unresolvedResolutions=list(UNRESOLVED_RESOLUTIONS),
            resolutions=list(RESOLUTIONS),
        )

    async def relationship_evidence(
        self, relationship_id: str
    ) -> PlsqlDependencyRecord | None:
        parts = _edge_parts(relationship_id)
        if parts is None:
            return None
        relationship, source_qualified_name, target_qualified_name = parts
        if relationship not in _TRIGGER_AWARE_RELATIONSHIPS:
            return None
        file_paths = await self._file_map()
        rows = await self._execute(
            EDGE_BY_TRIPLE,
            projectId=self._project_id,
            relationship=relationship,
            sourceQualifiedName=source_qualified_name,
            targetQualifiedName=target_qualified_name,
        )
        for row in rows:
            edge = self._dependency_from_row(row, file_paths)
            if edge is not None:
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
        bounded_hops = max(1, min(max_hops, self._max_hops))
        bounded = max(1, min(limit, self._max_rows))
        if source.qualified_name == target.qualified_name:
            return PlsqlPathPage(items=[], truncated=False, total=0)

        # Expand one frontier per hop instead of loading the project's edges:
        # each round fetches only the typed edges whose source is reachable at
        # that depth, within the traversal budget.
        file_paths = await self._file_map()
        edge_by_id: dict[str, PlsqlDependencyRecord] = {}
        discovered: set[tuple[str, ...]] = set()
        frontier: list[tuple[str, tuple[str, ...], frozenset[str]]] = [
            (source.qualified_name, (), frozenset({source.qualified_name}))
        ]

        for _ in range(bounded_hops):
            sources = sorted({current for current, _, _ in frontier})
            if not sources:
                break
            remaining = self._max_traversal_edges - len(edge_by_id)
            if remaining <= 0:
                raise PlsqlLimitExceeded(
                    "The dependency path search exceeded the gateway traversal bound."
                )
            rows = await self._execute(
                EDGE_OUTGOING,
                projectId=self._project_id,
                relationships=list(PATH_RELATIONSHIPS),
                sources=sources,
                limit=remaining + 1,
            )
            if len(rows) > remaining:
                raise PlsqlLimitExceeded(
                    "The dependency path search exceeded the gateway traversal bound."
                )
            outgoing: dict[str, list[PlsqlDependencyRecord]] = {}
            for row in rows:
                edge = self._dependency_from_row(row, file_paths)
                if edge is None or edge.id in edge_by_id:
                    continue
                edge_by_id[edge.id] = edge
                outgoing.setdefault(edge.source_qualified_name, []).append(edge)
            for out in outgoing.values():
                out.sort(key=lambda edge: edge.id)

            next_frontier: list[tuple[str, tuple[str, ...], frozenset[str]]] = []
            for current, trail, visited in frontier:
                for edge in outgoing.get(current, ()):
                    reached = edge.target_qualified_name
                    if reached in visited:
                        continue
                    new_trail = trail + (edge.id,)
                    if reached == target.qualified_name:
                        # Paths end at the target; it is never expanded.
                        discovered.add(new_trail)
                    else:
                        next_frontier.append((reached, new_trail, visited | {reached}))
            frontier = next_frontier

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
        bounded_hops = max(1, min(max_hops, self._max_hops))
        bounded = max(1, min(limit, self._max_rows))
        file_paths = await self._file_map()

        # A package impacts through its member routines when the graph keeps
        # edges on the members; otherwise the package node is the anchor.
        anchors: list[str]
        if changed.kind == "Package":
            prefix = f"{changed.qualified_name}."
            rows = await self._execute(
                EDGE_MEMBER_ENDPOINTS,
                projectId=self._project_id,
                relationships=list(TABLE_ACCESS_RELATIONSHIPS | {"CALLS"}),
                memberPrefix=prefix,
                limit=self._max_traversal_edges + 1,
            )
            if len(rows) > self._max_traversal_edges:
                raise PlsqlLimitExceeded(
                    "The impact search exceeded the gateway traversal bound."
                )
            members = sorted(
                {
                    str(qualified)
                    for row in rows
                    for key in ("sourceQualifiedName", "targetQualifiedName")
                    if (qualified := row.get(key)) is not None
                    and _owner_of(str(qualified)) == changed.name
                }
            )
            anchors = members or [changed.qualified_name]
        else:
            anchors = [changed.qualified_name]

        # Reverse frontier expansion: each round fetches only the typed edges
        # that target the dependents discovered at that depth.
        edge_by_id: dict[str, PlsqlDependencyRecord] = {}
        trails_by_dependent: dict[str, set[tuple[str, ...]]] = {}
        frontier: list[
            tuple[str, tuple[PlsqlDependencyRecord, ...], frozenset[str]]
        ] = [(anchor, (), frozenset({anchor})) for anchor in anchors]

        for _ in range(bounded_hops):
            targets = sorted({current for current, _, _ in frontier})
            if not targets:
                break
            remaining = self._max_traversal_edges - len(edge_by_id)
            if remaining <= 0:
                raise PlsqlLimitExceeded(
                    "The impact search exceeded the gateway traversal bound."
                )
            rows = await self._execute(
                EDGE_INCOMING,
                projectId=self._project_id,
                relationships=list(PATH_RELATIONSHIPS),
                targets=targets,
                limit=remaining + 1,
            )
            if len(rows) > remaining:
                raise PlsqlLimitExceeded(
                    "The impact search exceeded the gateway traversal bound."
                )
            incoming: dict[str, list[PlsqlDependencyRecord]] = {}
            for row in rows:
                edge = self._dependency_from_row(row, file_paths)
                if edge is None:
                    continue
                if edge.id not in edge_by_id:
                    edge_by_id[edge.id] = edge
                incoming.setdefault(edge.target_qualified_name, []).append(
                    edge_by_id[edge.id]
                )
            for in_edges in incoming.values():
                in_edges.sort(key=lambda edge: edge.id)

            next_frontier: list[
                tuple[str, tuple[PlsqlDependencyRecord, ...], frozenset[str]]
            ] = []
            for current, backward, seen in frontier:
                for edge in incoming.get(current, ()):
                    source_qn = edge.source_qualified_name
                    if source_qn in seen:
                        continue
                    chain = backward + (edge,)
                    forward = tuple(reversed(chain))
                    trails_by_dependent.setdefault(source_qn, set()).add(
                        tuple(step.id for step in forward)
                    )
                    next_frontier.append((source_qn, chain, seen | {source_qn}))
            frontier = next_frontier

        items: list[PlsqlImpactItemRecord] = []
        for dependent_qn, forward_trails in trails_by_dependent.items():
            if dependent_qn == changed.qualified_name:
                continue
            dependent = await self.get_object(
                make_object_id(self._project_id, dependent_qn)
            )
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
        return PlsqlImpactPage(
            items=items[:bounded],
            truncated=len(items) > bounded,
            total=len(items),
        )
