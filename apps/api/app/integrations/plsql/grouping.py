"""Collapse per-call-site edges into one dependency per object pair.

The graph stores one edge per source location, but an edge id is only the
(relationship, source, target) triple. Two calls to the same routine on
different lines are therefore one dependency with two occurrences, never two
dependencies: totals count objects, and the lines stay available as evidence.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from app.integrations.plsql.models import PlsqlDependencyRecord, PlsqlEvidence


def _coordinate_key(evidence: PlsqlEvidence) -> tuple[str, int, int, int]:
    return (
        evidence.path,
        evidence.start_line or 0,
        evidence.start_column or 0,
        evidence.start_offset or 0,
    )


def merge_occurrences(
    edges: Sequence[PlsqlDependencyRecord],
) -> PlsqlDependencyRecord:
    """Merge edges that share one id into a single record with its occurrences."""
    first = edges[0]
    unique: dict[tuple[str, int, int, int], PlsqlEvidence] = {}
    for edge in edges:
        for evidence in (*edge.occurrences, edge.evidence):
            if evidence is not None:
                unique.setdefault(_coordinate_key(evidence), evidence)
    occurrences = [unique[key] for key in sorted(unique)]
    return first.model_copy(
        update={
            "evidence": occurrences[0] if occurrences else first.evidence,
            "occurrences": occurrences,
            "occurrence_count": max(1, len(occurrences)),
        }
    )


def group_dependency_edges(
    edges: Iterable[PlsqlDependencyRecord],
) -> list[PlsqlDependencyRecord]:
    """Group edges by id, keeping the first-seen order of each group."""
    groups: dict[str, list[PlsqlDependencyRecord]] = {}
    for edge in edges:
        groups.setdefault(edge.id, []).append(edge)
    return [merge_occurrences(group) for group in groups.values()]
