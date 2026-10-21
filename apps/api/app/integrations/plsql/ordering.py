"""Alphabetical orderings shared by every list the console shows.

Lists are read in alphabetical order of the object's *name* (case-blind), with
the qualified name breaking ties, so a person can find a row by scanning the
page and paging stays stable. A view grouped by package asks for ``package``
order instead: packages alphabetically (objects outside any package last),
then names, so paging through the groups is also alphabetical from end to end.
The Neo4j catalog applies the same keys in Cypher; these helpers serve the
in-memory adapters and the impact walk.
"""

from __future__ import annotations

from app.integrations.plsql.models import PlsqlDependencyRecord, PlsqlObjectRecord
from app.models.plsql import ListOrder


def owner_of(qualified_name: str) -> str | None:
    """Package owner for member routines (``SCHEMA.PACKAGE.MEMBER``)."""
    parts = qualified_name.split(".")
    return parts[1] if len(parts) >= 3 else None


def package_of(name: str, qualified_name: str, kind: str) -> str | None:
    """The package an object is filed under: itself, or its owner."""
    return name if kind == "Package" else owner_of(qualified_name)


def object_key(
    name: str, qualified_name: str, kind: str, order: ListOrder
) -> tuple[int, str, str, str]:
    """Sort key of one object for the requested order."""
    if order == "package":
        package = package_of(name, qualified_name, kind)
        return (
            0 if package is not None else 1,
            (package or "").casefold(),
            name.casefold(),
            qualified_name.casefold(),
        )
    return (0, "", name.casefold(), qualified_name.casefold())


def object_tree_key(record: PlsqlObjectRecord) -> tuple[str, int, str, str]:
    """Explorer order: a package heads its members, names alphabetical."""
    return (
        (record.owner or record.name).casefold(),
        1 if record.owner else 0,
        record.name.casefold(),
        record.qualified_name.casefold(),
    )


def caller_order(
    edge: PlsqlDependencyRecord, order: ListOrder = "name"
) -> tuple[tuple[int, str, str, str], str, str]:
    """Callers are listed by the calling object."""
    return (
        object_key(
            edge.source_name, edge.source_qualified_name, edge.source_kind, order
        ),
        edge.target_qualified_name.casefold(),
        edge.relationship,
    )


def callee_order(
    edge: PlsqlDependencyRecord, order: ListOrder = "name"
) -> tuple[tuple[int, str, str, str], str, str]:
    """Callees are listed by the called object."""
    return (
        object_key(
            edge.target_name, edge.target_qualified_name, edge.target_kind, order
        ),
        edge.source_qualified_name.casefold(),
        edge.relationship,
    )
