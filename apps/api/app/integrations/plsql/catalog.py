"""Allowlisted, parameterized query catalog for the Neo4j analysis adapter.

The catalog is the only module that contains Cypher. Every entry is a static
query string that takes named parameters only (``$projectId``, ``$needle``,
``$qualifiedName``, ``$limit``, ...); client or document input is never
interpolated into a query (ADR 0012). Relationship names, edge evidence
properties, and the object/file node labels follow the consumed graph model
documented in ``docs/architecture/plsql-analysis-console.md`` §5.

Schema confirmation note (pending the first real graph):
``plsqlgraph`` owns the authoritative schema. This catalog pins the facts the
architecture document records and isolates the remaining assumptions in the
``SCHEMA_ASSUMPTIONS`` constants below so a real-graph alignment is a
single-file change:

- ``DatabaseObject`` nodes carry ``qualifiedName`` (and usually ``name``) and
  ``projectId``; object kind is a node label drawn from the kind vocabulary.
- ``SourceFile`` nodes carry a project-relative ``path``.
- Edge evidence properties ``resolution``, ``sourceFileId``, ``startLine``,
  ``startColumn``, ``startOffset``, ``endOffset`` (documented).

Before a first run against a real graph, confirm these against the graph and
adjust only this module (catalog entries) plus any row-mapping helper in
``neo4j_client.py`` that reads the ``SCHEMA_*`` constants.
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

# The maximum number of typed edges a project may expose through the gateway.
# The Neo4j adapter fetches the project's typed dependency edges and derives
# deterministic pages/paths client-side (same semantics as the synthetic
# adapter); this bound keeps that derivation bounded on large graphs.
MAX_PROJECT_EDGES: Final = 20_000


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


def _known_kind_clause() -> str:
    """Baseline constraint restricting search to addressable objects.

    The extractor also creates unresolved/ambiguous call-target placeholder
    nodes (labels such as ``Routine``, ``AmbiguousRoutine``) that carry no
    ``qualifiedName`` and no recognized kind label. Without this clause they
    sort first (missing qualifiedName coalesces to ``''``) and can fill an
    entire results page before the Python-side kind mapping ever runs,
    producing an empty page even though matching real objects exist. Those
    placeholders remain reachable through ``unresolved_references`` edges;
    they are simply not first-class searchable objects.
    """
    kinds_literal = "[" + ", ".join(f"'{kind}'" for kind in sorted(KIND_LABELS)) + "]"
    return (
        f"n.{SCHEMA_NODE_QUALIFIED_NAME} IS NOT NULL "
        f"AND any(label IN labels(n) WHERE label IN {kinds_literal})"
    )


SEARCH_OBJECTS: Final = f"""
MATCH (n:{OBJECT_LABEL})
WHERE n.{SCHEMA_NODE_PROJECT} = $projectId
  AND {_known_kind_clause()}
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
  AND {_known_kind_clause()}
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

PROJECT_EDGES: Final = f"""
MATCH (s:{OBJECT_LABEL})-[r]->(t:{OBJECT_LABEL})
WHERE s.{SCHEMA_NODE_PROJECT} = $projectId
  AND type(r) IN $relationships
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
