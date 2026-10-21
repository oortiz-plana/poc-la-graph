"""Per-category dependency counts plus one page of the selected category."""

from __future__ import annotations

from app.integrations.plsql.catalog import (
    DEPENDENCY_CATEGORIES,
    TABLE_ACCESS_BY_CATEGORY,
)
from app.integrations.plsql.client import AnalysisGraphClient
from app.integrations.plsql.models import (
    PlsqlDependencyPage,
    PlsqlDependencySummaryRecord,
)
from app.models.plsql import ListOrder, PlsqlDependencyCategory


async def summarize_dependencies(
    client: AnalysisGraphClient,
    *,
    object_id: str,
    category: PlsqlDependencyCategory,
    limit: int,
    offset: int = 0,
    relationship: str | None = None,
    order: ListOrder = "name",
) -> PlsqlDependencySummaryRecord:
    """Return every category's exact count plus the selected category's page.

    Each category is queried on its own, so each count is exact and a category
    late in the type order (writes) is never pushed off a page that another
    one already filled. ``relationship`` narrows the selected page and its
    ``total`` to one edge type of a table category (e.g. only ``TRIGGER_ON``
    within ``other``; the caller validates the pairing); ``counts`` always
    report whole categories.
    """
    narrowed = relationship is not None

    async def page(
        name: PlsqlDependencyCategory, size: int, start: int
    ) -> PlsqlDependencyPage:
        if name == "callers":
            return await client.callers_of(
                object_id=object_id, limit=size, offset=start, order=order
            )
        if name == "callees":
            return await client.callees_of(
                object_id=object_id, limit=size, offset=start, order=order
            )
        return await client.table_access_of(
            object_id=object_id,
            limit=size,
            offset=start,
            relationships=TABLE_ACCESS_BY_CATEGORY[name],
            order=order,
        )

    pages = {
        name: (
            await page(name, limit, offset)
            if name == category and not narrowed
            else await page(name, 1, 0)
        )
        for name in DEPENDENCY_CATEGORIES
    }
    selected = pages[category]
    if relationship is not None:
        selected = await client.table_access_of(
            object_id=object_id,
            limit=limit,
            offset=offset,
            relationships=frozenset({relationship}),
            order=order,
        )
    return PlsqlDependencySummaryRecord(
        counts={name: pages[name].total for name in DEPENDENCY_CATEGORIES},
        items=list(selected.items),
        truncated=selected.truncated,
        total=selected.total,
    )
