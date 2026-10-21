"""Allowlisted, parameterized query catalog for the Neo4j analysis adapter.

The catalog is the only module that contains Cypher. Every entry is a static
query string that takes named parameters only (``$projectId``, ``$needle``,
``$qualifiedName``, ``$limit``, ...); client or document input is never
interpolated into a query (ADR 0012). Relationship names, edge evidence
properties, and the object/file node labels follow the consumed graph model
documented in ``docs/architecture/plsql-analysis-console.md`` §5.

Schema confirmation note (confirmed against the ``vu_sfi`` real graph):
``plsqlgraph`` owns the authoritative schema. This catalog pins the facts the
architecture document records and isolates the remaining assumptions in the
``SCHEMA_ASSUMPTIONS`` constants below so a real-graph alignment is a
single-file change:

- ``DatabaseObject`` nodes carry ``qualifiedName`` (and usually ``name``) and
  ``projectId``; object kind is a node label drawn from the kind vocabulary.
  Object nodes do **not** carry source coordinates.
- ``SourceFile`` nodes carry a project-relative ``path`` (and a stable ``id``
  of the form ``file://<project>/<path>``).
- Edge evidence properties ``resolution``, ``sourceFileId``, ``startLine``,
  ``startColumn``, ``startOffset``, ``endOffset`` (documented). An object's
  declaration coordinates live on its ``DECLARES`` edge (``SourceFile ->
  DatabaseObject``); the edge ``sourceFileId`` is the build-host EMF resource
  URI (e.g. ``file:/C:/…``) and is not a project-relative path, so source
  reads resolve through ``SourceFile.path``.
- Derived edges (currently only ``TRIGGERS``) additionally carry
  ``derived``, ``events``, ``evidenceKind``, and ``viaTable`` (a
  ``plsql://<project>/<SCHEMA>/<KIND_TOKEN>/<NAME>`` reference to the table
  whose trigger mediates the invocation). These are ``null`` on every other
  relationship type.

Before changing an assumption against a new graph revision, confirm it against
the graph and adjust only this module (catalog entries) plus any row-mapping
helper in ``neo4j_client.py`` that reads the ``SCHEMA_*`` constants.
"""

from __future__ import annotations

from typing import Final, get_args

from app.models.plsql import (
    ObjectKind,
    PlsqlDependencyCategory,
    PlsqlRelationship,
    PlsqlResolution,
)

PROJECT_LABEL: Final = "Project"
OBJECT_LABEL: Final = "DatabaseObject"
SOURCE_FILE_LABEL: Final = "SourceFile"

# Kind is a node label drawn from the object-kind vocabulary (console §5).
# `DatabaseObject` itself and hierarchy labels such as `ExecutableUnit` are
# never treated as kinds.
KIND_LABELS: Final[frozenset[str]] = frozenset(get_args(ObjectKind))
RELATIONSHIPS: Final[frozenset[str]] = frozenset(get_args(PlsqlRelationship))
RESOLUTIONS: Final[frozenset[str]] = frozenset(get_args(PlsqlResolution))

# Reverse of the synthetic adapter's kind-token convention (fixtures.py's
# `_kind_token()`), used to parse the `viaTable` edge property's kind token
# back into an `ObjectKind`.
KIND_TOKENS: Final[dict[str, ObjectKind]] = {
    "TABLE": "Table",
    "VIEW": "View",
    "PACKAGE": "Package",
    "SEQUENCE": "Sequence",
    "TRIGGER": "Trigger",
    "INDEX": "Index",
    "SYNONYM": "Synonym",
    "TYPE": "Type",
    "PROCEDURE": "Procedure",
    "FUNCTION": "Function",
    "ANONYMOUS_BLOCK": "AnonymousBlock",
}

# Kind labels that never surface in object search results: synonyms are
# aliases to other objects, not analyzable objects (mirrored by the synthetic
# adapter's SEARCH_EXCLUDED_KINDS).
SEARCH_EXCLUDED_LABELS: Final[frozenset[str]] = frozenset({"Synonym"})

# Schema-shape assumptions centralized for the real-graph alignment pass.
SCHEMA_NODE_NAME: Final = "name"
SCHEMA_NODE_QUALIFIED_NAME: Final = "qualifiedName"
SCHEMA_NODE_PROJECT: Final = "projectId"
SCHEMA_EDGE_RESOLUTION: Final = "resolution"
SCHEMA_EDGE_SOURCE_FILE_ID: Final = "sourceFileId"
SCHEMA_EDGE_START_LINE: Final = "startLine"
SCHEMA_EDGE_START_COLUMN: Final = "startColumn"
SCHEMA_EDGE_START_OFFSET: Final = "startOffset"
SCHEMA_EDGE_END_OFFSET: Final = "endOffset"
SCHEMA_EDGE_DERIVED: Final = "derived"
SCHEMA_EDGE_EVENTS: Final = "events"
SCHEMA_EDGE_EVIDENCE_KIND: Final = "evidenceKind"
SCHEMA_EDGE_VIA_TABLE: Final = "viaTable"
SCHEMA_FILE_PATH: Final = "path"

PATH_RELATIONSHIPS: Final[frozenset[str]] = frozenset(
    {"CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON", "TRIGGERS", "FOREIGN_KEY"}
)
# Dependency-path search also walks `CONTAINS` so a package reaches the
# objects its member routines use (Package -> member -> Table). Impact keeps
# using `PATH_RELATIONSHIPS` and anchors packages through their members.
PATH_TRAVERSAL_RELATIONSHIPS: Final[frozenset[str]] = PATH_RELATIONSHIPS | {"CONTAINS"}
TABLE_ACCESS_RELATIONSHIPS: Final[frozenset[str]] = frozenset(
    {"READS", "WRITES", "TRIGGER_ON", "VIEW_DEPENDS_ON", "FOREIGN_KEY"}
)
# The dependency categories of the console, and which table-access types each of
# the table categories covers. Each category is queried on its own so its count
# and rows stay exact however many edges another category has.
DEPENDENCY_CATEGORIES: Final[tuple[PlsqlDependencyCategory, ...]] = (
    "callers",
    "callees",
    "reads",
    "writes",
    "other",
)
TABLE_ACCESS_BY_CATEGORY: Final[dict[str, frozenset[str]]] = {
    "reads": frozenset({"READS"}),
    "writes": frozenset({"WRITES"}),
    "other": TABLE_ACCESS_RELATIONSHIPS - {"READS", "WRITES"},
}
UNRESOLVED_RESOLUTIONS: Final[frozenset[str]] = frozenset({"AMBIGUOUS", "UNRESOLVED"})

# The maximum number of typed edges a project may expose through the gateway
# was previously enforced by loading every edge once (`MAX_EDGE_ROWS`); that
# design is gone. Each endpoint now fetches only the rows it needs (LIMIT
# page + 1) with a matching COUNT entry for the exact total, and path/impact
# traversals expand one bounded frontier at a time. The traversal budget is a
# Settings parameter (`plsql_max_traversal_edges`), not a catalog constant.

KINDS_LITERAL: Final = (
    "[" + ", ".join(f"'{kind}'" for kind in sorted(KIND_LABELS)) + "]"
)


def _name_search_clause() -> str:
    """Parameterized name/qualified-name containment filter (casefolded)."""
    name = SCHEMA_NODE_NAME
    qualified = SCHEMA_NODE_QUALIFIED_NAME
    return (
        f"($needle = '' OR toLower(coalesce(n.{qualified}, '')) CONTAINS $needle "
        f"OR toLower(coalesce(n.{name}, '')) CONTAINS $needle)"
    )


def _kind_filter(param: str) -> str:
    """Parameterized kind filter over node labels (labels are not dynamic)."""
    return f"(size(${param}) = 0 OR any(label IN labels(n) WHERE label IN ${param}))"


def _search_kind_exclusion(alias: str) -> str:
    """Exclude non-addressable kind labels from object search results."""
    return " AND ".join(
        f"NOT '{label}' IN labels({alias})" for label in sorted(SEARCH_EXCLUDED_LABELS)
    )


def _kind_constraint(alias: str) -> str:
    """Baseline constraint restricting an endpoint to addressable objects.

    The extractor also creates unresolved/ambiguous call-target placeholder
    nodes (labels such as ``Routine``, ``AmbiguousRoutine``) that carry no
    ``qualifiedName`` and no recognized kind label. Without this clause they
    sort first (missing qualifiedName coalesces to ``''``) and can fill an
    entire results page before the Python-side kind mapping ever runs,
    producing an empty page even though matching real objects exist. Those
    placeholders remain reachable through ``unresolved_references`` edges;
    they are simply not first-class searchable objects.
    """
    return (
        f"{alias}.{SCHEMA_NODE_QUALIFIED_NAME} IS NOT NULL "
        f"AND any(label IN labels({alias}) WHERE label IN {KINDS_LITERAL})"
    )


# The Explorer is a tree: a package heads its members, so results are ordered
# alphabetically by the top-level name (the owning package of a member, else
# the object's own name), then package before members, then by name.
_MEMBER_OWNER: Final = (
    f"CASE WHEN size(split(n.{SCHEMA_NODE_QUALIFIED_NAME}, '.')) >= 3 "
    f"THEN split(n.{SCHEMA_NODE_QUALIFIED_NAME}, '.')[1] "
    f"ELSE coalesce(n.{SCHEMA_NODE_NAME}, '') END"
)
SEARCH_TREE_ORDER: Final = (
    f"toLower({_MEMBER_OWNER}), "
    f"CASE WHEN size(split(n.{SCHEMA_NODE_QUALIFIED_NAME}, '.')) >= 3 "
    f"THEN 1 ELSE 0 END, "
    f"toLower(coalesce(n.{SCHEMA_NODE_NAME}, '')), "
    f"toLower(coalesce(n.{SCHEMA_NODE_QUALIFIED_NAME}, ''))"
)

SEARCH_OBJECTS: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND {_kind_constraint("n")}
  AND {_search_kind_exclusion("n")}
  AND {_name_search_clause()}
  AND {_kind_filter("kinds")}
RETURN n, labels(n) AS nodeLabels
ORDER BY {SEARCH_TREE_ORDER}
SKIP $offset
LIMIT $limit
"""

COUNT_SEARCH_OBJECTS: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND {_kind_constraint("n")}
  AND {_search_kind_exclusion("n")}
  AND {_name_search_clause()}
  AND {_kind_filter("kinds")}
RETURN count(n) AS total
"""

OBJECT_BY_QUALIFIED_NAME: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND n.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
RETURN n, labels(n) AS nodeLabels
ORDER BY CASE WHEN n:Synonym THEN 1 ELSE 0 END
LIMIT 1
"""

# Batched twin of ``OBJECT_BY_QUALIFIED_NAME`` for callers that resolve many
# objects at once (impact dependents). Real objects sort ahead of synonyms so
# the first row per qualified name is the same node the single lookup returns.
OBJECTS_BY_QUALIFIED_NAMES: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND n.{SCHEMA_NODE_QUALIFIED_NAME} IN $qualifiedNames
RETURN n, labels(n) AS nodeLabels
ORDER BY CASE WHEN n:Synonym THEN 1 ELSE 0 END
"""

# An object's declaration coordinates live on the ``DECLARES`` edge from its
# ``SourceFile``, not on the object node: the extractor stores evidence
# properties (``sourceFileId``, offsets, lines) on every edge, while the object
# node carries only identity/kind/signature properties. The reliable file
# coordinate is ``SourceFile.path`` (project-relative); the edge's
# ``sourceFileId`` is the build-host EMF resource URI and is intentionally not
# used here. A package shares one node across its spec and body files, so the
# declaration edge is disambiguated deterministically (earliest offset, then
# path).
OBJECT_DECLARATION: Final = f"""
MATCH (f:{SOURCE_FILE_LABEL})-[r:DECLARES]->(n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND n.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
RETURN f.{SCHEMA_FILE_PATH} AS path,
       coalesce(f.fileId, f.id, toString(elementId(f))) AS fileId,
       r.{SCHEMA_EDGE_START_LINE} AS startLine,
       r.{SCHEMA_EDGE_START_COLUMN} AS startColumn,
       r.{SCHEMA_EDGE_START_OFFSET} AS startOffset,
       r.{SCHEMA_EDGE_END_OFFSET} AS endOffset
ORDER BY r.{SCHEMA_EDGE_START_OFFSET}, f.{SCHEMA_FILE_PATH}
LIMIT 1
"""

# --- per-endpoint edge queries ---------------------------------------------
#
# Each list endpoint has a select twin (``LIMIT $limit`` = page size + 1 to
# compute `truncated`) and a count twin (exact `total`), sharing the same
# filters. ``_edge_validity_clause()`` keeps raw rows exactly mappable by the
# client so totals and pages always agree. Traversal queries (``EDGE_OUTGOING``
# / ``EDGE_INCOMING``) expand one bounded frontier per round instead of
# loading the project's edges.

_EDGE_PAIR_KEY: Final = (
    f"[s.{SCHEMA_NODE_QUALIFIED_NAME}, t.{SCHEMA_NODE_QUALIFIED_NAME}, type(r)]"
)

# Edges are stored per call site; the COUNT_EDGE_* twins count distinct
# (relationship, source, target) pairs to match the grouped dependencies.
EDGE_COLUMNS: Final = f"""
RETURN s.{SCHEMA_NODE_QUALIFIED_NAME} AS sourceQualifiedName,
       s.{SCHEMA_NODE_NAME} AS sourceName,
       labels(s) AS sourceLabels,
       t.{SCHEMA_NODE_QUALIFIED_NAME} AS targetQualifiedName,
       t.{SCHEMA_NODE_NAME} AS targetName,
       labels(t) AS targetLabels,
       type(r) AS relationship,
       coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') AS resolution,
       r.{SCHEMA_EDGE_SOURCE_FILE_ID} AS sourceFileId,
       r.{SCHEMA_EDGE_START_LINE} AS startLine,
       r.{SCHEMA_EDGE_START_COLUMN} AS startColumn,
       r.{SCHEMA_EDGE_START_OFFSET} AS startOffset,
       r.{SCHEMA_EDGE_END_OFFSET} AS endOffset,
       r.{SCHEMA_EDGE_DERIVED} AS derived,
       r.{SCHEMA_EDGE_EVENTS} AS events,
       r.{SCHEMA_EDGE_EVIDENCE_KIND} AS evidenceKind,
       r.{SCHEMA_EDGE_VIA_TABLE} AS viaTable
"""

# Matches the client's sort keys (relationship, casefolded source qualified
# name, casefolded target qualified name). ``toLower`` is exact for the ASCII
# identifiers of this corpus, matching Python ``casefold`` there.
EDGE_ORDER: Final = f"""
ORDER BY type(r),
         toLower(coalesce(s.{SCHEMA_NODE_QUALIFIED_NAME}, '')),
         toLower(coalesce(t.{SCHEMA_NODE_QUALIFIED_NAME}, ''))
"""


def _package_expr(alias: str) -> str:
    """Package an object is filed under (itself, or its owner), else null."""
    qualified = f"{alias}.{SCHEMA_NODE_QUALIFIED_NAME}"
    return (
        f"CASE WHEN 'Package' IN labels({alias}) THEN {alias}.{SCHEMA_NODE_NAME} "
        f"WHEN size(split({qualified}, '.')) >= 3 THEN split({qualified}, '.')[1] "
        f"ELSE null END"
    )


def _object_order(alias: str, by_package: bool) -> str:
    """Sort keys of one node: its name, or its package first when requested."""
    name = (
        f"toLower(coalesce({alias}.{SCHEMA_NODE_NAME}, '')), "
        f"toLower(coalesce({alias}.{SCHEMA_NODE_QUALIFIED_NAME}, ''))"
    )
    if not by_package:
        return name
    package = _package_expr(alias)
    return f"({package}) IS NULL, toLower(coalesce({package}, '')), {name}"


def _order_by(*aliases: str, by_package: bool = False) -> str:
    keys = ", ".join(_object_order(alias, by_package) for alias in aliases)
    return f"ORDER BY {keys}, type(r)"


def _table_access_order(by_package: bool) -> str:
    """Order by the other end: the target when this object is the source."""
    in_scope = (
        f"(s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName "
        f"OR s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)"
    )

    def other(expression_for: str) -> str:
        return (
            f"CASE WHEN {in_scope} THEN {expression_for.replace('@', 't')} "
            f"ELSE {expression_for.replace('@', 's')} END"
        )

    name = f"toLower(coalesce(@.{SCHEMA_NODE_NAME}, ''))"
    qualified = f"toLower(coalesce(@.{SCHEMA_NODE_QUALIFIED_NAME}, ''))"
    keys = [other(name), other(qualified)]
    if by_package:
        package = _package_expr("@")
        keys = [
            other(f"({package}) IS NULL"),
            other(f"toLower(coalesce({package}, ''))"),
            *keys,
        ]
    return "ORDER BY " + ", ".join(keys) + ", type(r)"


# Dependency lists are read in alphabetical order of the *other* object (the
# caller, the callee, the table…), or package-first when the view groups by
# package, so every page and every row cap sees the order the console shows.


def _edge_validity_clause() -> str:
    """Constraints that keep returned rows exactly mappable by the client."""
    return (
        f"coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $resolutions "
        f"AND {_kind_constraint('s')} "
        f"AND {_kind_constraint('t')}"
    )


# A package's callers/callees span its members. The queried object is returned
# as the fixed end ($qualifiedName/$objectName/$objectLabels), so every member
# call between the same two objects groups into ONE dependency with all its
# call sites, and the count is of distinct callers/callees, matching Overview.
_CALLERS_COLUMNS: Final = (
    EDGE_COLUMNS.replace(
        f"t.{SCHEMA_NODE_QUALIFIED_NAME} AS targetQualifiedName",
        "$qualifiedName AS targetQualifiedName",
    )
    .replace(f"t.{SCHEMA_NODE_NAME} AS targetName", "$objectName AS targetName")
    .replace("labels(t) AS targetLabels", "$objectLabels AS targetLabels")
)
_CALLEES_COLUMNS: Final = (
    EDGE_COLUMNS.replace(
        f"s.{SCHEMA_NODE_QUALIFIED_NAME} AS sourceQualifiedName",
        "$qualifiedName AS sourceQualifiedName",
    )
    .replace(f"s.{SCHEMA_NODE_NAME} AS sourceName", "$objectName AS sourceName")
    .replace("labels(s) AS sourceLabels", "$objectLabels AS sourceLabels")
)


def _callers_query(order: str) -> str:
    return f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND (t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  AND {_edge_validity_clause()}
{_CALLERS_COLUMNS}
{order}
LIMIT $limit
"""


COUNT_EDGE_CALLERS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND (t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  AND {_edge_validity_clause()}
RETURN count(DISTINCT s.{SCHEMA_NODE_QUALIFIED_NAME}) AS total
"""


def _callees_query(order: str) -> str:
    return f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND (s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  AND {_edge_validity_clause()}
{_CALLEES_COLUMNS}
{order}
LIMIT $limit
"""


COUNT_EDGE_CALLEES: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND (s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  AND {_edge_validity_clause()}
RETURN count(DISTINCT t.{SCHEMA_NODE_QUALIFIED_NAME}) AS total
"""


def _table_access_query(order: str) -> str:
    return f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND (
    (
      (s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
      AND any(label IN labels(t) WHERE label IN $tableKinds)
    )
    OR (t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
        OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  )
  AND {_edge_validity_clause()}
{EDGE_COLUMNS}
{order}
LIMIT $limit
"""


COUNT_EDGE_TABLE_ACCESS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND (
    (
      (s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
       OR s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
      AND any(label IN labels(t) WHERE label IN $tableKinds)
    )
    OR (t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
        OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
  )
  AND {_edge_validity_clause()}
RETURN count(DISTINCT {_EDGE_PAIR_KEY}) AS total
"""

EDGE_CALLERS: Final = _callers_query(_order_by("s", "t"))
EDGE_CALLERS_BY_PACKAGE: Final = _callers_query(_order_by("s", "t", by_package=True))
EDGE_CALLEES: Final = _callees_query(_order_by("t", "s"))
EDGE_CALLEES_BY_PACKAGE: Final = _callees_query(_order_by("t", "s", by_package=True))
EDGE_TABLE_ACCESS: Final = _table_access_query(_table_access_order(False))
EDGE_TABLE_ACCESS_BY_PACKAGE: Final = _table_access_query(_table_access_order(True))

# Unresolved/ambiguous call targets are placeholder nodes (labels ``Routine``,
# ``AmbiguousRoutine``, or a ``Table`` with no ``qualifiedName``) that carry
# only ``name`` and ``id``, so these queries cannot require a qualified name or
# a kind label on the target the way every other edge query does: doing so hid
# every unresolved edge of a real graph. The source stays a real object. The
# optional scope keeps one object's (or package's members') edges, applied in
# the query so a row cap never truncates before the filter.
_UNRESOLVED_SCOPE_CLAUSE: Final = (
    f"($scopeQn IS NULL OR s.{SCHEMA_NODE_QUALIFIED_NAME} = $scopeQn "
    f"OR ($scopePrefix IS NOT NULL "
    f"AND s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $scopePrefix))"
)
_UNRESOLVED_PAIR_KEY: Final = (
    f"[s.{SCHEMA_NODE_QUALIFIED_NAME}, "
    f"coalesce(t.{SCHEMA_NODE_QUALIFIED_NAME}, t.{SCHEMA_NODE_NAME}), type(r)]"
)

EDGE_UNRESOLVED: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $unresolvedResolutions
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $resolutions
  AND {_kind_constraint("s")}
  AND t.{SCHEMA_NODE_NAME} IS NOT NULL
  AND {_UNRESOLVED_SCOPE_CLAUSE}
{EDGE_COLUMNS.rstrip()},
       t.id AS targetNodeId
ORDER BY toLower(coalesce(s.{SCHEMA_NODE_NAME}, '')),
         toLower(coalesce(s.{SCHEMA_NODE_QUALIFIED_NAME}, '')),
         toLower(coalesce(t.{SCHEMA_NODE_NAME}, '')),
         type(r)
LIMIT $limit
"""

COUNT_EDGE_UNRESOLVED: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $unresolvedResolutions
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $resolutions
  AND {_kind_constraint("s")}
  AND t.{SCHEMA_NODE_NAME} IS NOT NULL
  AND {_UNRESOLVED_SCOPE_CLAUSE}
RETURN count(DISTINCT {_UNRESOLVED_PAIR_KEY}) AS total
"""

EDGE_BY_TRIPLE: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = $relationship
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} = $sourceQualifiedName
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} = $targetQualifiedName
{EDGE_COLUMNS}
LIMIT 2
"""

EDGE_OUTGOING: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} IN $sources
{EDGE_COLUMNS}
{EDGE_ORDER}
LIMIT $limit
"""

EDGE_INCOMING: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} IN $targets
{EDGE_COLUMNS}
{EDGE_ORDER}
LIMIT $limit
"""

# Impact walks objects, not call sites: one row per distinct hop, no evidence.
_EDGE_HOP_COLUMNS: Final = f"""
RETURN DISTINCT s.{SCHEMA_NODE_QUALIFIED_NAME} AS sourceQualifiedName,
       labels(s) AS sourceLabels,
       t.{SCHEMA_NODE_QUALIFIED_NAME} AS targetQualifiedName,
       labels(t) AS targetLabels,
       type(r) AS relationship,
       coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') AS resolution
LIMIT $limit
"""

EDGE_HOPS_INCOMING: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} IN $targets
{_EDGE_HOP_COLUMNS}
"""

EDGE_HOPS_OUTGOING: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} IN $sources
{_EDGE_HOP_COLUMNS}
"""

# Evidence for the hops of the routes on one page: $hops is a list of
# [relationship, source, target] triples.
EDGE_BY_HOPS: Final = f"""
UNWIND $hops AS hop
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} = hop[1]
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} = hop[2]
  AND type(r) = hop[0]
{EDGE_COLUMNS}
LIMIT $limit
"""

EDGE_MEMBER_ENDPOINTS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND (s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix
       OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
RETURN DISTINCT s.{SCHEMA_NODE_QUALIFIED_NAME} AS sourceQualifiedName,
       t.{SCHEMA_NODE_QUALIFIED_NAME} AS targetQualifiedName
LIMIT $limit
"""

# The index every qualifiedName lookup depends on; created by
# `docker/neo4j/schema/001-indexes.cypher` (and by the graph loader).
REQUIRED_QUALIFIED_NAME_INDEX: Final = "plsql_database_object_qualified_name"

INDEX_STATE: Final = """
SHOW INDEXES YIELD name, state
WHERE name = $indexName
RETURN state
"""

SOURCE_FILES: Final = f"""
MATCH (f:{SOURCE_FILE_LABEL})
WHERE f.{SCHEMA_NODE_PROJECT} IS NULL OR f.{SCHEMA_NODE_PROJECT} = $projectId
RETURN f.{SCHEMA_FILE_PATH} AS path,
       coalesce(f.fileId, f.id, toString(elementId(f))) AS fileId
"""

SOURCE_FILE_BY_PATH: Final = f"""
MATCH (f:{SOURCE_FILE_LABEL})
WHERE f.{SCHEMA_NODE_PROJECT} IS NULL OR f.{SCHEMA_NODE_PROJECT} = $projectId
RETURN f.{SCHEMA_FILE_PATH} AS path,
       coalesce(f.fileId, f.id, toString(elementId(f))) AS fileId
ORDER BY f.{SCHEMA_FILE_PATH}
LIMIT 1
"""
