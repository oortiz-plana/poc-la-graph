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

Before changing an assumption against a new graph revision, confirm it against
the graph and adjust only this module (catalog entries) plus any row-mapping
helper in ``neo4j_client.py`` that reads the ``SCHEMA_*`` constants.
"""

from __future__ import annotations

from typing import Final, get_args

from app.models.plsql import ObjectKind, PlsqlRelationship, PlsqlResolution

PROJECT_LABEL: Final = "Project"
OBJECT_LABEL: Final = "DatabaseObject"
SOURCE_FILE_LABEL: Final = "SourceFile"

# Kind is a node label drawn from the object-kind vocabulary (console §5).
# `DatabaseObject` itself and hierarchy labels such as `ExecutableUnit` are
# never treated as kinds.
KIND_LABELS: Final[frozenset[str]] = frozenset(get_args(ObjectKind))
RELATIONSHIPS: Final[frozenset[str]] = frozenset(get_args(PlsqlRelationship))
RESOLUTIONS: Final[frozenset[str]] = frozenset(get_args(PlsqlResolution))

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
SCHEMA_FILE_PATH: Final = "path"

PATH_RELATIONSHIPS: Final[frozenset[str]] = frozenset(
    {"CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON"}
)
TABLE_ACCESS_RELATIONSHIPS: Final[frozenset[str]] = frozenset(
    {"READS", "WRITES", "TRIGGER_ON", "VIEW_DEPENDS_ON"}
)
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


SEARCH_OBJECTS: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND {_kind_constraint("n")}
  AND {_search_kind_exclusion("n")}
  AND {_name_search_clause()}
  AND {_kind_filter("kinds")}
RETURN n, labels(n) AS nodeLabels
ORDER BY toLower(coalesce(n.{SCHEMA_NODE_QUALIFIED_NAME}, '')),
         coalesce(n.{SCHEMA_NODE_NAME}, '')
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
LIMIT 1
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
       r.{SCHEMA_EDGE_END_OFFSET} AS endOffset
"""

# Matches the client's sort keys (relationship, casefolded source qualified
# name, casefolded target qualified name). ``toLower`` is exact for the ASCII
# identifiers of this corpus, matching Python ``casefold`` there.
EDGE_ORDER: Final = f"""
ORDER BY type(r),
         toLower(coalesce(s.{SCHEMA_NODE_QUALIFIED_NAME}, '')),
         toLower(coalesce(t.{SCHEMA_NODE_QUALIFIED_NAME}, ''))
"""


def _edge_validity_clause() -> str:
    """Constraints that keep returned rows exactly mappable by the client."""
    return (
        f"coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $resolutions "
        f"AND {_kind_constraint('s')} "
        f"AND {_kind_constraint('t')}"
    )


EDGE_CALLERS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
  AND {_edge_validity_clause()}
{EDGE_COLUMNS}
{EDGE_ORDER}
LIMIT $limit
"""

COUNT_EDGE_CALLERS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND t.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
  AND {_edge_validity_clause()}
RETURN count(*) AS total
"""

EDGE_CALLEES: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
  AND {_edge_validity_clause()}
{EDGE_COLUMNS}
{EDGE_ORDER}
LIMIT $limit
"""

COUNT_EDGE_CALLEES: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) = 'CALLS'
  AND s.{SCHEMA_NODE_QUALIFIED_NAME} = $qualifiedName
  AND {_edge_validity_clause()}
RETURN count(*) AS total
"""

EDGE_TABLE_ACCESS: Final = f"""
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
{EDGE_ORDER}
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
RETURN count(*) AS total
"""

EDGE_UNRESOLVED: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $unresolvedResolutions
  AND {_edge_validity_clause()}
{EDGE_COLUMNS}
{EDGE_ORDER}
LIMIT $limit
"""

COUNT_EDGE_UNRESOLVED: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND coalesce(r.{SCHEMA_EDGE_RESOLUTION}, 'EXACT') IN $unresolvedResolutions
  AND {_edge_validity_clause()}
RETURN count(*) AS total
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

EDGE_MEMBER_ENDPOINTS: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
  AND (s.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix
       OR t.{SCHEMA_NODE_QUALIFIED_NAME} STARTS WITH $memberPrefix)
RETURN s.{SCHEMA_NODE_QUALIFIED_NAME} AS sourceQualifiedName,
       t.{SCHEMA_NODE_QUALIFIED_NAME} AS targetQualifiedName
LIMIT $limit
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
