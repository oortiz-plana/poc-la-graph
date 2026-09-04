"""Read-only PL/SQL analysis gateway integration.

Owns every path from this product to the analyzed PL/SQL graph (ADR 0012):
domain protocol, deterministic synthetic adapter, error normalization. The
public contract lives in `app.models.plsql`; the Neo4j adapter is deferred
behind a dependency decision.
"""

from app.integrations.plsql.client import AnalysisGraphClient
from app.integrations.plsql.errors import (
    PlsqlConfigurationError,
    PlsqlError,
    PlsqlLimitExceeded,
    PlsqlNotConfigured,
    PlsqlObjectNotFound,
    PlsqlTimeout,
    PlsqlUnavailable,
)
from app.integrations.plsql.synthetic import SyntheticPlsqlAnalysisClient

__all__ = [
    "AnalysisGraphClient",
    "PlsqlConfigurationError",
    "PlsqlError",
    "PlsqlLimitExceeded",
    "PlsqlNotConfigured",
    "PlsqlObjectNotFound",
    "PlsqlTimeout",
    "PlsqlUnavailable",
    "SyntheticPlsqlAnalysisClient",
]
