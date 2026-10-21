"""Object-level shortest-route graph behind an impact report (pure, no I/O).

Impact is computed in two independent steps so neither is bounded by how many
call sites the graph stores:

1. A breadth-first walk over *objects* keeps, per reached object, only its
   distance and the distinct edges that reach it at that distance. This is
   everything the totals, the blast-radius summary, scope filters and
   ordering need; no evidence rows are read.
2. Only the objects on the requested page are expanded into routes, and only
   the edges of those routes are loaded with their evidence.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from itertools import islice
from typing import Final

from app.integrations.plsql.models import PlsqlImpactSummaryRecord
from app.integrations.plsql.ordering import object_key, owner_of
from app.models.plsql import ImpactDirection, ImpactScope, ListOrder, ObjectKind

_TABLE_OR_VIEW: Final[frozenset[str]] = frozenset({"Table", "View"})


@dataclass(frozen=True, slots=True)
class ImpactEdge:
    """One distinct (relationship, source, target) hop between two objects."""

    relationship: str
    source: str
    target: str
    source_kind: ObjectKind
    target_kind: ObjectKind

    @property
    def writes_table(self) -> bool:
        return self.relationship == "WRITES" and self.target_kind in _TABLE_OR_VIEW


def schema_of(qualified_name: str) -> str:
    return qualified_name.split(".", 1)[0]


class ImpactGraph:
    """Shortest-route DAG from an impact walk, queryable without I/O."""

    def __init__(
        self,
        *,
        anchors: frozenset[str],
        changed: str,
        direction: ImpactDirection,
        distance: dict[str, int],
        kinds: dict[str, ObjectKind],
        parents: dict[str, list[ImpactEdge]],
    ) -> None:
        self._anchors = anchors
        self._direction = direction
        self._parents = parents
        self._distance = distance
        self._kinds = kinds
        names = [name for name in distance if name != changed]

        # Alphabetical by object name, whatever the distance: the distance is a
        # column of the list, not its order.
        def key(name: str, order: ListOrder) -> tuple[tuple[int, str, str, str], str]:
            return (
                object_key(name.rsplit(".", 1)[-1], name, kinds.get(name, ""), order),
                name,
            )

        self._ordered: tuple[str, ...] = tuple(
            sorted(names, key=lambda name: key(name, "name"))
        )
        # The same dependents with packages alphabetical first, for views that
        # group by package (objects outside any package last).
        self._ordered_by_package: tuple[str, ...] = tuple(
            sorted(names, key=lambda name: key(name, "package"))
        )
        self._writers = self._writing_dependents()
        self.summary = self._summarize()

    def _next_toward_anchor(self, edge: ImpactEdge) -> str:
        return edge.target if self._direction == "upstream" else edge.source

    def _writing_dependents(self) -> frozenset[str]:
        """Dependents with a shortest route through a write to a table or view."""
        writers: set[str] = set()
        for name in sorted(self._distance, key=self._distance.__getitem__):
            for edge in self._parents[name]:
                inner = self._next_toward_anchor(edge)
                if edge.writes_table or inner in writers:
                    writers.add(name)
                    break
        return frozenset(writers)

    def _owns_package(self, name: str) -> bool:
        return owner_of(name) is not None or self._kinds.get(name) == "Package"

    def _summarize(self) -> PlsqlImpactSummaryRecord:
        direct = sum(1 for name in self._ordered if self._distance[name] == 1)
        packages = {
            (schema_of(name), owner_of(name) or name.rsplit(".", 1)[-1])
            for name in self._ordered
            if self._owns_package(name)
        }
        tables = {
            edge.target
            for name in self._ordered
            for edge in self._parents[name]
            if edge.writes_table
        }
        return PlsqlImpactSummaryRecord(
            direct=direct,
            indirect=max(0, len(self._ordered) - direct),
            packages=len(packages),
            tables_modified=len(tables),
        )

    def distance_of(self, name: str) -> int:
        return self._distance[name]

    def names(self, scope: ImpactScope = "all", order: ListOrder = "name") -> list[str]:
        """Dependents behind one summary card, in the requested order."""
        ordered = self._ordered if order == "name" else self._ordered_by_package
        if scope == "all":
            return list(ordered)
        if scope == "direct":
            return [n for n in ordered if self._distance[n] == 1]
        if scope == "indirect":
            return [n for n in ordered if self._distance[n] > 1]
        if scope == "packages":
            return [n for n in ordered if self._owns_package(n)]
        return [n for n in ordered if n in self._writers]

    def routes(self, name: str, limit: int) -> list[tuple[ImpactEdge, ...]]:
        """Up to ``limit`` shortest routes in flow order, deterministic."""
        return list(islice(self._routes_from(name), limit))

    def _routes_from(self, name: str) -> Iterator[tuple[ImpactEdge, ...]]:
        for edge in sorted(
            self._parents.get(name, ()),
            key=lambda e: (e.relationship, e.source, e.target),
        ):
            inner = self._next_toward_anchor(edge)
            onward: Iterator[tuple[ImpactEdge, ...]] = (
                iter([()]) if inner in self._anchors else self._routes_from(inner)
            )
            for rest in onward:
                yield (edge, *rest) if self._direction == "upstream" else (*rest, edge)


class ImpactGraphBuilder:
    """Accumulates one breadth-first frontier at a time."""

    def __init__(
        self, *, anchors: Sequence[str], changed: str, direction: ImpactDirection
    ) -> None:
        self._anchors = frozenset(anchors)
        self._changed = changed
        self._direction = direction
        self._distance: dict[str, int] = {}
        self._kinds: dict[str, ObjectKind] = {}
        self._parents: dict[str, list[ImpactEdge]] = {}
        self._expanded: set[str] = set()
        self._frontier: list[str] = sorted(self._anchors)

    def next_frontier(self) -> list[str]:
        """Objects not yet expanded; claims them so each is expanded once."""
        keys = [name for name in self._frontier if name not in self._expanded]
        self._expanded.update(keys)
        return keys

    def expand(self, edges: Iterable[ImpactEdge], depth: int) -> None:
        """Record the edges attached to the frontier handed out last."""
        upstream = self._direction == "upstream"
        next_frontier: list[str] = []
        seen: set[ImpactEdge] = set()
        for edge in sorted(edges, key=lambda e: (e.relationship, e.source, e.target)):
            if edge in seen:
                continue
            seen.add(edge)
            current = edge.target if upstream else edge.source
            peer = edge.source if upstream else edge.target
            if peer == current:
                continue
            reached_at = self._distance.get(peer)
            if reached_at is None:
                self._distance[peer] = depth
                self._kinds[peer] = edge.source_kind if upstream else edge.target_kind
                self._parents[peer] = [edge]
                next_frontier.append(peer)
            elif reached_at == depth:
                self._parents[peer].append(edge)
        self._frontier = next_frontier

    def build(self) -> ImpactGraph:
        return ImpactGraph(
            anchors=self._anchors,
            changed=self._changed,
            direction=self._direction,
            distance=self._distance,
            kinds=self._kinds,
            parents=self._parents,
        )
