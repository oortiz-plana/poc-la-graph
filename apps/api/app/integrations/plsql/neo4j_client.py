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
import logging
import time
from collections import OrderedDict
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from typing import Any, Final, cast

import neo4j
from neo4j import GraphDatabase

from app.integrations.plsql.catalog import (
    COUNT_EDGE_CALLEES,
    COUNT_EDGE_CALLERS,
    COUNT_EDGE_TABLE_ACCESS,
    COUNT_EDGE_UNRESOLVED,
    COUNT_SEARCH_OBJECTS,
    EDGE_BY_HOPS,
    EDGE_BY_TRIPLE,
    EDGE_CALLEES,
    EDGE_CALLEES_BY_PACKAGE,
    EDGE_CALLERS,
    EDGE_CALLERS_BY_PACKAGE,
    EDGE_HOPS_INCOMING,
    EDGE_HOPS_OUTGOING,
    EDGE_INCOMING,
    EDGE_MEMBER_ENDPOINTS,
    EDGE_OUTGOING,
    EDGE_TABLE_ACCESS,
    EDGE_TABLE_ACCESS_BY_PACKAGE,
    EDGE_UNRESOLVED,
    INDEX_STATE,
    KIND_TOKENS,
    OBJECT_BY_QUALIFIED_NAME,
    OBJECT_DECLARATION,
    OBJECTS_BY_QUALIFIED_NAMES,
    PATH_RELATIONSHIPS,
    PATH_TRAVERSAL_RELATIONSHIPS,
    REQUIRED_QUALIFIED_NAME_INDEX,
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
from app.integrations.plsql.dependency_summary import summarize_dependencies
from app.integrations.plsql.errors import (
    PlsqlConfigurationError,
    PlsqlError,
    PlsqlLimitExceeded,
    PlsqlObjectNotFound,
    PlsqlTimeout,
    PlsqlUnavailable,
)
from app.integrations.plsql.grouping import group_dependency_edges
from app.integrations.plsql.impact_graph import (
    ImpactEdge,
    ImpactGraph,
    ImpactGraphBuilder,
    schema_of,
)
from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencyRecord,
    PlsqlDependencySummaryRecord,
    PlsqlEvidence,
    PlsqlFileRecord,
    PlsqlHealthCategoryRecord,
    PlsqlHealthRecord,
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
from app.integrations.plsql.ordering import owner_of
from app.integrations.plsql.source import (
    read_source_lines,
    resolve_source_file,
    source_root,
)
from app.models.plsql import (
    ImpactDirection,
    ImpactScope,
    ListOrder,
    ObjectKind,
    PlsqlDependencyCategory,
    PlsqlHealthCategoryName,
    PlsqlRelationship,
    PlsqlResolution,
)

logger = logging.getLogger("graphify_agent.api")

CONNECTIVITY_QUERY: Final = "RETURN 1 AS ok"

# Qualified names per batched object lookup; keeps the parameter list bounded.
_OBJECT_LOOKUP_CHUNK: Final = 500
# "Why is this affected?" shows shortest routes only; a dense graph can hold
# thousands per dependent, so keep a deterministic handful.
_MAX_IMPACT_ROUTES_PER_DEPENDENT: Final = 5
# Frontier objects per hop query and hops per evidence query, which keep both
# parameter lists and result sets bounded on dense graphs.
_HOP_FRONTIER_CHUNK: Final = 200
_HOP_EVIDENCE_CHUNK: Final = 200
# Traversals are recomputed for every page of a report, so a finished result
# is kept briefly and shared by in-flight duplicates. The graph is a read-only
# load, which makes a short TTL safe; ``0`` disables the cache.
_IMPACT_CACHE_TTL_SECONDS: Final = 60.0
_IMPACT_CACHE_MAX_ENTRIES: Final = 16
_TABLE_OR_VIEW: Final[frozenset[str]] = frozenset({"Table", "View"})
_KIND_LABEL_PRIORITY: Final[tuple[ObjectKind, ...]] = (
    "Procedure",
    "Function",
    "Package",
    "Trigger",
    "Table",
    "View",
    "Sequence",
    "Index",
    "Type",
    "AnonymousBlock",
    "Synonym",
)
# `PATH_TRAVERSAL_RELATIONSHIPS` already includes `TRIGGERS` and `CONTAINS`
# (catalog.py); this set just adds `TRIGGER_ON` on top, so a new member there
# is picked up here automatically and never needs a direct edit.
_TRIGGER_AWARE_RELATIONSHIPS: Final[frozenset[str]] = PATH_TRAVERSAL_RELATIONSHIPS | {
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


def _chunks[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _kind_from_labels(labels: Sequence[str]) -> ObjectKind | None:
    label_set = set(labels)
    for label in _KIND_LABEL_PRIORITY:
        if label in label_set:
            return label
    return None


_PLACEHOLDER_ROUTINE_LABELS: Final[frozenset[str]] = frozenset(
    {"Routine", "AmbiguousRoutine"}
)


def _placeholder_kind(labels: Sequence[str]) -> ObjectKind | None:
    """Kind of an unresolved call target: a callable of unknown flavour."""
    return "Procedure" if _PLACEHOLDER_ROUTINE_LABELS & set(labels) else None


def _placeholder_qualified_name(
    node_id: str | None, name: str | None, source_qualified_name: str
) -> str | None:
    """``SCHEMA.NAME`` of a placeholder from its id (``plsql://<project>/<SCHEMA>/...``)."""
    if not name:
        return None
    schema = source_qualified_name.split(".", 1)[0]
    if node_id and node_id.startswith("plsql://"):
        parts = node_id[len("plsql://") :].split("/")
        if len(parts) >= 3 and parts[1]:
            schema = parts[1]
    return f"{schema}.{name}"


def _via_table_reference(
    raw: object, project_id: str
) -> tuple[str, ObjectKind, str, str] | None:
    """Parse a `viaTable` edge property into an object reference.

    Expected format: ``plsql://<project>/<SCHEMA>/<KIND_TOKEN>/<NAME>``
    (the synthetic adapter's own object-id convention, coincidentally what
    the real extractor also writes into this property). Returns
    ``(object_id, kind, name, qualified_name)``, or ``None`` on any
    malformed or unrecognized input — this is an upstream-format
    assumption, never a hard failure.
    """
    if not isinstance(raw, str) or not raw.startswith("plsql://"):
        return None
    parts = raw[len("plsql://") :].split("/")
    if len(parts) != 4:
        return None
    _project, schema, kind_token, name = parts
    kind = KIND_TOKENS.get(kind_token)
    if kind is None or not schema or not name:
        return None
    qualified_name = f"{schema}.{name}"
    return (object_id(project_id, qualified_name), kind, name, qualified_name)


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


_ImpactKey = tuple[str, int, ImpactDirection, frozenset[str]]
_ImpactCacheEntry = tuple[float, ImpactGraph]


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
        source_encoding: str = "iso-8859-1",
        impact_cache_ttl_seconds: float = _IMPACT_CACHE_TTL_SECONDS,
        impact_cache_max_entries: int = _IMPACT_CACHE_MAX_ENTRIES,
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
        self._source_encoding = source_encoding
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
        self._index_checked = False
        self._object_cache: dict[str, PlsqlObjectRecord | None] = {}
        self._impact_cache_ttl = max(0.0, impact_cache_ttl_seconds)
        self._impact_cache_max = max(1, impact_cache_max_entries)
        self._impact_cache: OrderedDict[_ImpactKey, _ImpactCacheEntry] = OrderedDict()
        self._impact_inflight: dict[_ImpactKey, asyncio.Task[ImpactGraph]] = {}

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
        await self._warn_if_index_missing()
        return "connected"

    async def _warn_if_index_missing(self) -> None:
        """Log once when the qualifiedName index is absent or not online.

        Every hop and object lookup matches on ``qualifiedName``; without the
        index each one scans all objects. A restored or reloaded graph can
        lose it, so surface that instead of leaving only slow pages behind.
        """
        if self._index_checked:
            return
        try:
            rows = await self._execute(
                INDEX_STATE, indexName=REQUIRED_QUALIFIED_NAME_INDEX
            )
        except PlsqlError:
            logger.warning(
                "plsql_index_check_failed",
                extra={"index": REQUIRED_QUALIFIED_NAME_INDEX},
                exc_info=True,
            )
            return
        self._index_checked = True
        state = str(rows[0].get("state")) if rows else None
        if state != "ONLINE":
            logger.warning(
                "plsql_index_missing",
                extra={"index": REQUIRED_QUALIFIED_NAME_INDEX, "state": state},
            )

    # --- graph projections -------------------------------------------------

    async def _file_map(self) -> dict[str, str]:
        """Map graph file ids to project-relative paths (lazy, cached).

        Some extractors write the project-relative path itself into an
        edge's ``sourceFileId`` instead of the ``SourceFile`` node's id (seen
        on trigger-body ``CALLS`` evidence in the real graph), so a path
        maps to itself here too: ``_resolve_path_sync`` then resolves either
        form through the same single lookup.
        """
        if self._file_map_cache is not None:
            return self._file_map_cache
        rows = await self._execute(SOURCE_FILES, projectId=self._project_id)
        mapping: dict[str, str] = {}
        for row in rows:
            path = row.get(SCHEMA_FILE_PATH)
            file_key = row.get("fileId")
            if path and file_key:
                mapping[str(file_key)] = str(path)
                mapping[str(path)] = str(path)
        self._file_map_cache = mapping
        return mapping

    async def _resolve_path(self, file_id: str | None) -> str | None:
        """Resolve a graph file id (or an already project-relative path) to
        its canonical project-relative path, best effort. Delegates to
        `_resolve_path_sync` so evidence resolution (edges/objects) and
        on-demand source fetches share one implementation.
        """
        if file_id is None:
            return None
        mapping = await self._file_map()
        return self._resolve_path_sync(file_id, mapping)

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
            schema_name=schema_of(qualified),
            qualified_name=qualified,
            project_id=self._project_id,
            owner=owner_of(qualified),
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
        target_labels = row.get("targetLabels") or ()
        if not target_qn and source_qn and "targetNodeId" in row:
            # An unresolved/ambiguous target is a placeholder node with only a
            # name and an id; give it a stable qualified name in the caller's
            # schema so it reads like any other reference.
            target_qn = _placeholder_qualified_name(
                _str_or_none(row.get("targetNodeId")),
                _str_or_none(row.get("targetName")),
                str(source_qn),
            )
        if (
            relationship not in _TRIGGER_AWARE_RELATIONSHIPS
            or resolution not in RESOLUTIONS
            or not source_qn
            or not target_qn
        ):
            return None
        source_kind = _kind_from_labels(row.get("sourceLabels") or ())
        target_kind = _kind_from_labels(target_labels) or _placeholder_kind(
            target_labels
        )
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
        via_table = _via_table_reference(row.get("viaTable"), self._project_id)
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
            evidence_kind=_str_or_none(row.get("evidenceKind")),
            derived=(
                row.get("derived") if isinstance(row.get("derived"), bool) else None
            ),
            events=_str_or_none(row.get("events")),
            via_table_id=via_table[0] if via_table else None,
            via_table_kind=via_table[1] if via_table else None,
            via_table_name=via_table[2] if via_table else None,
            via_table_qualified_name=via_table[3] if via_table else None,
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
        offset: int = 0,
        **params: object,
    ) -> PlsqlDependencyPage:
        """Run a targeted edge select (page + 1) plus its count twin.

        Ordering comes from the catalog's deterministic ``ORDER BY``; the
        count query shares every filter so ``total`` matches mappable rows.
        Edges are one per call site, so every row up to the traversal bound
        is fetched, grouped into one dependency per object pair, and only then
        paged; ``total`` counts those distinct pairs.
        """
        bounded = max(1, min(limit, self._max_rows))
        start = max(0, offset)
        file_paths = await self._file_map()
        rows = await self._execute(query, limit=self._max_traversal_edges + 1, **params)
        row_capped = len(rows) > self._max_traversal_edges
        items = self._map_edges(rows[: self._max_traversal_edges], file_paths)
        total = int((await self._execute(count_query, **params))[0]["total"])
        return PlsqlDependencyPage(
            items=items[start : start + bounded],
            truncated=len(items) > start + bounded or row_capped,
            total=total,
        )

    def _map_edges(
        self, rows: Iterable[Mapping[str, Any]], file_paths: Mapping[str, str]
    ) -> list[PlsqlDependencyRecord]:
        """Map catalog rows, collapsing call sites of one pair into one edge."""
        return group_dependency_edges(
            edge
            for row in rows
            if (edge := self._dependency_from_row(row, file_paths)) is not None
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

    async def _objects_by_qualified_name(
        self, qualified_names: Sequence[str]
    ) -> dict[str, PlsqlObjectRecord | None]:
        """Resolve many objects with one query per chunk instead of one each.

        Shares ``_object_cache`` with :meth:`get_object`, so names already
        resolved cost nothing and every name looked up here is cached
        afterwards (unknown names are cached as ``None``).
        """
        resolved: dict[str, PlsqlObjectRecord | None] = {}
        missing: list[str] = []
        for qualified_name in dict.fromkeys(qualified_names):
            cache_key = object_id(self._project_id, qualified_name)
            if cache_key in self._object_cache:
                resolved[qualified_name] = self._object_cache[cache_key]
            else:
                missing.append(qualified_name)
        if not missing:
            return resolved

        file_paths = await self._file_map()
        for start in range(0, len(missing), _OBJECT_LOOKUP_CHUNK):
            chunk = missing[start : start + _OBJECT_LOOKUP_CHUNK]
            rows = await self._execute(
                OBJECTS_BY_QUALIFIED_NAMES,
                projectId=self._project_id,
                qualifiedNames=chunk,
            )
            found: dict[str, PlsqlObjectRecord] = {}
            for row in rows:
                record = self._object_from_node(
                    row.get("n"), row.get("nodeLabels") or (), file_paths
                )
                if record is not None:
                    found.setdefault(record.qualified_name, record)
            for qualified_name in chunk:
                record = found.get(qualified_name)
                self._object_cache[object_id(self._project_id, qualified_name)] = record
                resolved[qualified_name] = record
        return resolved

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
        offset: int = 0,
    ) -> PlsqlSearchPage:
        bounded = max(1, min(limit, self._max_rows))
        start = max(0, offset)
        needle = query.casefold().strip()
        kind_list = list(kinds or ())
        rows = await self._execute(
            SEARCH_OBJECTS,
            projectId=self._project_id,
            needle=needle,
            kinds=kind_list,
            offset=start,
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
            truncated=total > start + bounded,
            total=total,
        )

    # --- dependency lists --------------------------------------------------

    async def callers_of(
        self,
        *,
        object_id: str,
        limit: int,
        offset: int = 0,
        order: ListOrder = "name",
    ) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=EDGE_CALLERS if order == "name" else EDGE_CALLERS_BY_PACKAGE,
            count_query=COUNT_EDGE_CALLERS,
            limit=limit,
            offset=offset,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            memberPrefix=f"{record.qualified_name}.",
            objectName=record.name,
            objectLabels=["DatabaseObject", record.kind],
            resolutions=list(RESOLUTIONS),
        )

    async def callees_of(
        self,
        *,
        object_id: str,
        limit: int,
        offset: int = 0,
        order: ListOrder = "name",
    ) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=EDGE_CALLEES if order == "name" else EDGE_CALLEES_BY_PACKAGE,
            count_query=COUNT_EDGE_CALLEES,
            limit=limit,
            offset=offset,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            memberPrefix=f"{record.qualified_name}.",
            objectName=record.name,
            objectLabels=["DatabaseObject", record.kind],
            resolutions=list(RESOLUTIONS),
        )

    async def table_access_of(
        self,
        *,
        object_id: str,
        limit: int,
        relationships: frozenset[str] | None = None,
        offset: int = 0,
        order: ListOrder = "name",
    ) -> PlsqlDependencyPage:
        record = await self._require_object(object_id)
        return await self._dependency_page(
            query=(
                EDGE_TABLE_ACCESS if order == "name" else EDGE_TABLE_ACCESS_BY_PACKAGE
            ),
            count_query=COUNT_EDGE_TABLE_ACCESS,
            limit=limit,
            offset=offset,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
            memberPrefix=f"{record.qualified_name}.",
            relationships=sorted(
                TABLE_ACCESS_RELATIONSHIPS
                if relationships is None
                else relationships & TABLE_ACCESS_RELATIONSHIPS
            ),
            tableKinds=sorted(_TABLE_OR_VIEW),
            resolutions=list(RESOLUTIONS),
        )

    async def unresolved_references(self, *, limit: int) -> PlsqlDependencyPage:
        return await self._unresolved_page(
            resolutions=UNRESOLVED_RESOLUTIONS, record=None, limit=limit
        )

    async def _unresolved_page(
        self,
        *,
        resolutions: Collection[str],
        record: PlsqlObjectRecord | None,
        limit: int,
        offset: int = 0,
    ) -> PlsqlDependencyPage:
        """Unresolved/ambiguous edges, optionally scoped to one object or package."""
        return await self._dependency_page(
            query=EDGE_UNRESOLVED,
            count_query=COUNT_EDGE_UNRESOLVED,
            limit=limit,
            offset=offset,
            projectId=self._project_id,
            relationships=list(TABLE_ACCESS_RELATIONSHIPS | {"CALLS"}),
            unresolvedResolutions=sorted(resolutions),
            resolutions=list(RESOLUTIONS),
            scopeQn=record.qualified_name if record else None,
            scopePrefix=(
                f"{record.qualified_name}."
                if record is not None and record.kind == "Package"
                else None
            ),
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
        grouped = self._map_edges(rows, file_paths)
        return grouped[0] if grouped else None

    # --- source ------------------------------------------------------------

    async def object_source(self, *, object_id: str) -> PlsqlSourceRecord | None:
        """Return the declaration file of an object when evidence is present.

        Declaration coordinates live on the ``DECLARES`` edge
        (``SourceFile -> DatabaseObject``), not on the object node; the
        reliable file coordinate is the ``SourceFile.path`` (project-relative)
        rather than the edge's build-host ``sourceFileId`` URI. Objects with no
        resolvable declaration edge return ``None`` (the router answers
        ``analysis_not_found``).
        """
        record = await self._require_object(object_id)
        rows = await self._execute(
            OBJECT_DECLARATION,
            projectId=self._project_id,
            qualifiedName=record.qualified_name,
        )
        if not rows:
            return None
        row = rows[0]
        path = _str_or_none(row.get("path"))
        if not path:
            return None
        file_id = _str_or_none(row.get("fileId"))
        if file_id is None:
            # Reconstruct the deterministic stable id (StableIdFactory.sourceFile)
            # when a future graph omits the SourceFile.id property.
            file_id = f"file://{self._project_id}/{path}"
        return await self._load_source(
            file_id=file_id,
            path=path,
            start_line=_int_or_none(row.get("startLine")),
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
            read_source_lines, resolved, self._max_source_bytes, self._source_encoding
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
        offset: int = 0,
    ) -> PlsqlPathPage:
        source = await self._require_object(from_id)
        target = await self._require_object(to_id)
        bounded_hops = max(1, min(max_hops, self._max_hops))
        bounded = max(1, min(limit, self._max_rows))
        bounded_offset = max(0, offset)
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
                relationships=list(PATH_TRAVERSAL_RELATIONSHIPS),
                sources=sources,
                limit=remaining + 1,
            )
            if len(rows) > remaining:
                raise PlsqlLimitExceeded(
                    "The dependency path search exceeded the gateway traversal bound."
                )
            outgoing: dict[str, list[PlsqlDependencyRecord]] = {}
            for edge in self._map_edges(rows, file_paths):
                if edge.id in edge_by_id:
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
        page_end = bounded_offset + bounded
        return PlsqlPathPage(
            items=records[bounded_offset:page_end],
            truncated=len(records) > page_end,
            total=len(records),
        )

    async def _impact_anchors(self, changed: PlsqlObjectRecord) -> list[str]:
        """Qualified names impact walks backwards from.

        A package impacts through its member routines when the graph keeps
        edges on the members; otherwise the package node is the anchor.
        """
        if changed.kind != "Package":
            return [changed.qualified_name]
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
                and owner_of(str(qualified)) == changed.name
            }
        )
        return members or [changed.qualified_name]

    async def impact_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
        direction: ImpactDirection = "upstream",
        relationships: frozenset[str] | None = None,
        offset: int = 0,
        scope: ImpactScope = "all",
        order: ListOrder = "name",
    ) -> PlsqlImpactPage:
        """Return one page of transitive impact; totals never need its routes."""
        graph = await self._impact_graph(object_id, max_hops, direction, relationships)
        bounded = max(1, min(limit, self._max_rows))
        bounded_offset = max(0, offset)
        scoped = graph.names(scope, order)
        page_end = bounded_offset + bounded
        return PlsqlImpactPage(
            items=await self._impact_items(graph, scoped[bounded_offset:page_end]),
            truncated=len(scoped) > page_end,
            total=len(scoped),
        )

    async def impact_summary_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        direction: ImpactDirection = "upstream",
        relationships: frozenset[str] | None = None,
    ) -> PlsqlImpactSummaryRecord:
        """Return the blast-radius counts without loading any route evidence."""
        graph = await self._impact_graph(object_id, max_hops, direction, relationships)
        return graph.summary

    async def _impact_graph(
        self,
        object_id: str,
        max_hops: int,
        direction: ImpactDirection,
        relationships: frozenset[str] | None,
    ) -> ImpactGraph:
        """Return the object-level impact graph, computed once per key.

        Every page of a report, its summary, and identical concurrent requests
        reuse the finished walk instead of walking the graph again.
        """
        changed = await self._require_object(object_id)
        bounded_hops = max(1, min(max_hops, self._max_hops))
        rels = (
            frozenset(relationships)
            if relationships is not None
            else PATH_RELATIONSHIPS
        )
        if self._impact_cache_ttl <= 0:
            return await self._walk_impact(changed, bounded_hops, direction, rels)
        key: _ImpactKey = (changed.id, bounded_hops, direction, rels)
        cached = self._impact_cache.get(key)
        if cached is not None and cached[0] > time.monotonic():
            self._impact_cache.move_to_end(key)
            return cached[1]
        self._impact_cache.pop(key, None)

        task = self._impact_inflight.get(key)
        if task is None:
            task = asyncio.create_task(
                self._walk_impact(changed, bounded_hops, direction, rels)
            )
            self._impact_inflight[key] = task
            task.add_done_callback(lambda _: self._impact_inflight.pop(key, None))
        graph = await asyncio.shield(task)
        self._impact_cache[key] = (time.monotonic() + self._impact_cache_ttl, graph)
        self._impact_cache.move_to_end(key)
        while len(self._impact_cache) > self._impact_cache_max:
            self._impact_cache.popitem(last=False)
        return graph

    async def _walk_impact(
        self,
        changed: PlsqlObjectRecord,
        bounded_hops: int,
        direction: ImpactDirection,
        rels: frozenset[str],
    ) -> ImpactGraph:
        """Breadth-first over objects: each is expanded once, at its distance."""
        builder = ImpactGraphBuilder(
            anchors=await self._impact_anchors(changed),
            changed=changed.qualified_name,
            direction=direction,
        )
        for depth in range(1, bounded_hops + 1):
            keys = builder.next_frontier()
            if not keys:
                break
            chunks = await asyncio.gather(
                *(
                    self._hops_of(
                        keys[start : start + _HOP_FRONTIER_CHUNK], direction, rels
                    )
                    for start in range(0, len(keys), _HOP_FRONTIER_CHUNK)
                )
            )
            builder.expand((edge for chunk in chunks for edge in chunk), depth)
        return builder.build()

    async def _hops_of(
        self, keys: list[str], direction: ImpactDirection, rels: frozenset[str]
    ) -> list[ImpactEdge]:
        """Distinct hops attached to one slice of the frontier."""
        upstream = direction == "upstream"
        rows = await self._execute(
            EDGE_HOPS_INCOMING if upstream else EDGE_HOPS_OUTGOING,
            projectId=self._project_id,
            relationships=list(rels),
            **{"targets" if upstream else "sources": keys},
            limit=self._max_traversal_edges + 1,
        )
        if len(rows) > self._max_traversal_edges:
            raise PlsqlLimitExceeded(
                "The impact search exceeded the gateway traversal bound."
            )
        edges: list[ImpactEdge] = []
        for row in rows:
            source_kind = _kind_from_labels(row.get("sourceLabels") or ())
            target_kind = _kind_from_labels(row.get("targetLabels") or ())
            source = row.get("sourceQualifiedName")
            target = row.get("targetQualifiedName")
            if (
                source_kind is None
                or target_kind is None
                or not source
                or not target
                or (row.get("resolution") or "EXACT") not in RESOLUTIONS
            ):
                continue
            edges.append(
                ImpactEdge(
                    relationship=str(row["relationship"]),
                    source=str(source),
                    target=str(target),
                    source_kind=source_kind,
                    target_kind=target_kind,
                )
            )
        return edges

    async def _impact_items(
        self, graph: ImpactGraph, names: list[str]
    ) -> list[PlsqlImpactItemRecord]:
        """Expand one page of dependents into routes with per-hop evidence."""
        routes_by_name = {
            name: graph.routes(name, _MAX_IMPACT_ROUTES_PER_DEPENDENT) for name in names
        }
        dependents = await self._objects_by_qualified_name(names)
        evidence = await self._hop_evidence(
            {
                (edge.relationship, edge.source, edge.target)
                for routes in routes_by_name.values()
                for route in routes
                for edge in route
            }
        )
        items: list[PlsqlImpactItemRecord] = []
        for name in names:
            dependent = dependents.get(name)
            if dependent is None:
                continue
            paths: list[PlsqlPathRecord] = []
            for route in routes_by_name[name]:
                steps = [
                    hop
                    for edge in route
                    if (
                        hop := evidence.get(
                            edge_id(
                                self._project_id,
                                edge.relationship,
                                edge.source,
                                edge.target,
                            )
                        )
                    )
                    is not None
                ]
                if len(steps) == len(route):
                    paths.append(
                        PlsqlPathRecord(
                            id=self._path_id(
                                self._project_id, tuple(step.id for step in steps)
                            ),
                            steps=steps,
                            hop_count=len(steps),
                        )
                    )
            distance = graph.distance_of(name)
            items.append(
                PlsqlImpactItemRecord(
                    id=f"impact://{self._project_id}/{dependent.id}/d{distance}",
                    dependent=dependent,
                    distance=distance,
                    paths=sorted(
                        paths,
                        key=lambda path: (
                            tuple(step.target_qualified_name for step in path.steps),
                            tuple(step.id for step in path.steps),
                        ),
                    ),
                )
            )
        return items

    async def _hop_evidence(
        self, hops: set[tuple[str, str, str]]
    ) -> dict[str, PlsqlDependencyRecord]:
        """Load grouped, evidence-bearing dependencies for specific hops."""
        if not hops:
            return {}
        file_paths = await self._file_map()
        ordered = sorted(hops)
        found: dict[str, PlsqlDependencyRecord] = {}
        for start in range(0, len(ordered), _HOP_EVIDENCE_CHUNK):
            rows = await self._execute(
                EDGE_BY_HOPS,
                projectId=self._project_id,
                hops=[
                    list(hop) for hop in ordered[start : start + _HOP_EVIDENCE_CHUNK]
                ],
                limit=self._max_traversal_edges,
            )
            for edge in self._map_edges(rows, file_paths):
                found[edge.id] = edge
        return found

    async def health(
        self,
        *,
        object_id: str | None,
        limit: int,
        category: PlsqlHealthCategoryName | None = None,
        offset: int = 0,
    ) -> PlsqlHealthRecord:
        """Return analysis-quality diagnostics grouped by category."""
        record = (
            await self._require_object(object_id) if object_id is not None else None
        )
        bounded = max(1, min(limit, self._max_rows))

        async def page(
            name: PlsqlHealthCategoryName, resolution: str
        ) -> tuple[PlsqlDependencyPage, bool]:
            listed = category in (None, name)
            return await self._unresolved_page(
                resolutions={resolution},
                record=record,
                limit=bounded if listed else 1,
                offset=offset if category == name else 0,
            ), listed

        (unresolved, list_unresolved) = await page("unresolved", "UNRESOLVED")
        (ambiguous, list_ambiguous) = await page("ambiguous", "AMBIGUOUS")
        empty = PlsqlHealthCategoryRecord(count=0, items=[])
        return PlsqlHealthRecord(
            total=unresolved.total + ambiguous.total,
            unresolved=PlsqlHealthCategoryRecord(
                count=unresolved.total,
                items=list(unresolved.items) if list_unresolved else [],
            ),
            ambiguous=PlsqlHealthCategoryRecord(
                count=ambiguous.total,
                items=list(ambiguous.items) if list_ambiguous else [],
            ),
            dynamic_sql=empty,
            parse_errors=empty,
            unsupported=empty,
            truncated=unresolved.truncated or ambiguous.truncated,
        )

    async def dependencies_of(
        self,
        *,
        object_id: str,
        category: PlsqlDependencyCategory,
        limit: int,
        offset: int = 0,
        relationship: str | None = None,
        order: ListOrder = "name",
    ) -> PlsqlDependencySummaryRecord:
        """Return per-category counts plus the selected category's page."""
        await self._require_object(object_id)
        return await summarize_dependencies(
            self,
            object_id=object_id,
            category=category,
            limit=max(1, min(limit, self._max_rows)),
            offset=offset,
            relationship=relationship,
            order=order,
        )

    async def overview_of(
        self,
        *,
        object_id: str,
        max_hops: int,
        limit: int,
    ) -> PlsqlOverviewRecord:
        """Return headline counts and the first direct callers of an object."""
        record = await self._require_object(object_id)
        anchors = await self._impact_anchors(record)
        access = await self.table_access_of(object_id=object_id, limit=self._max_rows)
        impact = await self.impact_of(
            object_id=object_id, max_hops=max_hops, limit=self._max_rows
        )
        file_paths = await self._file_map()

        async def anchor_edges(
            query: str,
            key: str,
            relationships: frozenset[str],
        ) -> list[PlsqlDependencyRecord]:
            rows = await self._execute(
                query,
                projectId=self._project_id,
                relationships=list(relationships),
                **{key: anchors},
                limit=self._max_traversal_edges + 1,
            )
            if len(rows) > self._max_traversal_edges:
                raise PlsqlLimitExceeded(
                    "The overview search exceeded the gateway traversal bound."
                )
            return [
                edge
                for row in rows
                if (edge := self._dependency_from_row(row, file_paths)) is not None
            ]

        incoming = await anchor_edges(EDGE_INCOMING, "targets", PATH_RELATIONSHIPS)
        callers = await anchor_edges(EDGE_INCOMING, "targets", frozenset({"CALLS"}))
        callees = await anchor_edges(EDGE_OUTGOING, "sources", frozenset({"CALLS"}))
        caller_ids = list(dict.fromkeys(edge.source_id for edge in callers))
        callee_ids = list(dict.fromkeys(edge.target_id for edge in callees))
        top_callers: list[PlsqlObjectRecord] = []
        for caller_id in caller_ids[:limit]:
            caller = await self.get_object(caller_id)
            if caller is not None:
                top_callers.append(caller)
        return PlsqlOverviewRecord(
            object=record,
            direct_dependents=len({edge.source_id for edge in incoming}),
            indirect_dependents=max(0, impact.total - len(incoming)),
            callers=len(caller_ids),
            callees=len(callee_ids),
            tables_accessed=len(
                {
                    edge.target_id
                    for edge in access.items
                    if edge.target_kind in _TABLE_OR_VIEW
                }
            ),
            top_callers=top_callers,
        )
