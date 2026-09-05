"""Read-only PL/SQL analysis gateway integration.

Owns every path from this product to the analyzed PL/SQL graph (ADR 0012):
domain protocol, deterministic synthetic adapter, the allowlisted query
catalog, and the read-only Neo4j adapter. The public contract lives in
`app.models.plsql`.
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
from app.integrations.plsql.neo4j_client import Neo4jPlsqlAnalysisClient
from app.integrations.plsql.synthetic import SyntheticPlsqlAnalysisClient

__all__ = [
    "AnalysisGraphClient",
    "Neo4jPlsqlAnalysisClient",
    "PlsqlConfigurationError",
    "PlsqlError",
    "PlsqlLimitExceeded",
    "PlsqlNotConfigured",
    "PlsqlObjectNotFound",
    "PlsqlTimeout",
    "PlsqlUnavailable",
    "SyntheticPlsqlAnalysisClient",
]
