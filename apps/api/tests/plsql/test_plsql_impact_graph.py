"""Pure tests for the object-level impact graph (no database, no I/O)."""

from __future__ import annotations

from app.integrations.plsql.impact_graph import (
    ImpactEdge,
    ImpactGraph,
    ImpactGraphBuilder,
)
from app.models.plsql import ImpactDirection


def _hop(
    relationship: str,
    source: str,
    target: str,
    *,
    source_kind: str = "Function",
    target_kind: str = "Function",
) -> ImpactEdge:
    return ImpactEdge(
        relationship=relationship,
        source=source,
        target=target,
        source_kind=source_kind,  # type: ignore[arg-type]
        target_kind=target_kind,  # type: ignore[arg-type]
    )


def _walk(
    edges: list[ImpactEdge],
    *,
    anchor: str = "HR.T",
    direction: ImpactDirection = "upstream",
    hops: int = 10,
) -> ImpactGraph:
    builder = ImpactGraphBuilder(anchors=[anchor], changed=anchor, direction=direction)
    for depth in range(1, hops + 1):
        keys = builder.next_frontier()
        if not keys:
            break
        end = "target" if direction == "upstream" else "source"
        builder.expand((e for e in edges if getattr(e, end) in keys), depth)
    return builder.build()


def test_distances_are_shortest_and_ordered_by_distance_then_name() -> None:
    graph = _walk(
        [
            _hop("READS", "HR.B", "HR.T", target_kind="Table"),
            _hop("READS", "HR.A", "HR.T", target_kind="Table"),
            _hop("CALLS", "HR.C", "HR.A"),
            _hop("CALLS", "HR.C", "HR.B"),
            _hop("CALLS", "HR.D", "HR.C"),
        ]
    )

    assert graph.names() == ["HR.A", "HR.B", "HR.C", "HR.D"]
    assert [graph.distance_of(n) for n in graph.names()] == [1, 1, 2, 3]
    assert graph.names("direct") == ["HR.A", "HR.B"]
    assert graph.names("indirect") == ["HR.C", "HR.D"]
    assert graph.summary.direct == 2
    assert graph.summary.indirect == 2


def test_routes_are_capped_and_follow_flow_order() -> None:
    graph = _walk(
        [
            _hop("READS", "HR.A", "HR.T", target_kind="Table"),
            _hop("READS", "HR.B", "HR.T", target_kind="Table"),
            _hop("CALLS", "HR.C", "HR.A"),
            _hop("CALLS", "HR.C", "HR.B"),
        ]
    )

    routes = graph.routes("HR.C", 5)
    assert [[(e.source, e.target) for e in route] for route in routes] == [
        [("HR.C", "HR.A"), ("HR.A", "HR.T")],
        [("HR.C", "HR.B"), ("HR.B", "HR.T")],
    ]
    assert len(graph.routes("HR.C", 1)) == 1


def test_summary_counts_distinct_packages_and_tables_written() -> None:
    graph = _walk(
        [
            _hop("WRITES", "HR.PKG.ONE", "HR.T", target_kind="Table"),
            _hop("WRITES", "HR.PKG.TWO", "HR.T", target_kind="Table"),
            _hop("READS", "HR.STANDALONE", "HR.T", target_kind="Table"),
            _hop("CALLS", "HR.CALLER", "HR.PKG.ONE"),
        ]
    )

    assert graph.summary.packages == 1
    assert graph.summary.tables_modified == 1
    assert graph.names("packages") == ["HR.PKG.ONE", "HR.PKG.TWO"]


def test_tables_modified_scope_includes_callers_of_writers_only() -> None:
    graph = _walk(
        [
            _hop("WRITES", "HR.WRITER", "HR.T", target_kind="Table"),
            _hop("READS", "HR.READER", "HR.T", target_kind="Table"),
            _hop("CALLS", "HR.VIA_WRITER", "HR.WRITER"),
            _hop("CALLS", "HR.VIA_READER", "HR.READER"),
        ]
    )

    assert graph.names("tablesModified") == ["HR.VIA_WRITER", "HR.WRITER"]


def test_cycles_terminate_and_never_list_the_changed_object() -> None:
    graph = _walk(
        [
            _hop("CALLS", "HR.A", "HR.T"),
            _hop("CALLS", "HR.T", "HR.A"),
            _hop("CALLS", "HR.A", "HR.A"),
        ]
    )

    assert graph.names() == ["HR.A"]


def test_downstream_walks_dependencies_in_flow_order() -> None:
    graph = _walk(
        [
            _hop("CALLS", "HR.T", "HR.A"),
            _hop("CALLS", "HR.A", "HR.B"),
        ],
        direction="downstream",
    )

    assert graph.names() == ["HR.A", "HR.B"]
    (route,) = graph.routes("HR.B", 5)
    assert [(e.source, e.target) for e in route] == [("HR.T", "HR.A"), ("HR.A", "HR.B")]


def test_order_is_alphabetical_by_name_not_by_distance() -> None:
    graph = _walk(
        [
            _hop("CALLS", "HR.PKG.ZETA", "HR.T"),
            _hop("CALLS", "HR.ALPHA", "HR.PKG.ZETA"),
            _hop("CALLS", "HR.MIKE", "HR.T"),
        ]
    )

    assert graph.names() == ["HR.ALPHA", "HR.MIKE", "HR.PKG.ZETA"]
    assert [graph.distance_of(name) for name in graph.names()] == [2, 1, 1]


def test_package_order_lists_packages_alphabetically_then_names() -> None:
    graph = _walk(
        [
            _hop("CALLS", "HR.ZEBRA", "HR.T"),
            _hop("CALLS", "HR.PKG_B.ALPHA", "HR.T"),
            _hop("CALLS", "HR.PKG_A.OMEGA", "HR.T"),
            _hop("CALLS", "HR.PKG_A.BETA", "HR.T"),
            _hop("CALLS", "HR.PKG_B", "HR.T", source_kind="Package"),
        ]
    )

    assert graph.names(order="package") == [
        "HR.PKG_A.BETA",
        "HR.PKG_A.OMEGA",
        # A package is filed under itself; within PKG_B its members sort by name.
        "HR.PKG_B.ALPHA",
        "HR.PKG_B",
        "HR.ZEBRA",
    ]
    # By name the same dependents interleave regardless of package.
    assert graph.names() == [
        "HR.PKG_B.ALPHA",
        "HR.PKG_A.BETA",
        "HR.PKG_A.OMEGA",
        "HR.PKG_B",
        "HR.ZEBRA",
    ]
