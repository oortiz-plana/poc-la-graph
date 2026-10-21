"""Narrow impact items to the blast-radius card a client selected."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from app.integrations.plsql.models import PlsqlImpactItemRecord
from app.models.plsql import ImpactScope

_TABLE_OR_VIEW: Final[frozenset[str]] = frozenset({"Table", "View"})


def filter_impact_items(
    items: Sequence[PlsqlImpactItemRecord], scope: ImpactScope
) -> list[PlsqlImpactItemRecord]:
    """Return the items behind one summary card, keeping their order.

    Filtering happens before pagination so a selected card pages through its
    own rows instead of whatever the unfiltered first page happened to hold.
    ``tablesModified`` matches items whose shortest explaining paths write a
    table or view; the card's own count spans every traversed trail.
    """
    if scope == "all":
        return list(items)
    if scope == "direct":
        return [item for item in items if item.distance == 1]
    if scope == "indirect":
        return [item for item in items if item.distance > 1]
    if scope == "packages":
        return [
            item
            for item in items
            if item.dependent.owner or item.dependent.kind == "Package"
        ]
    return [
        item
        for item in items
        if any(
            step.relationship == "WRITES" and step.target_kind in _TABLE_OR_VIEW
            for path in item.paths
            for step in path.steps
        )
    ]
