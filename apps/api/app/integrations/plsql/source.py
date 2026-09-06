"""Read-only source file access scoped strictly under a configured root.

The gateway never trusts client-supplied filesystem paths: source reads are
keyed by opaque file/object identifiers that the analyzed graph (or the
synthetic fixture metadata) resolves to project-relative paths, and every
read re-checks that the resolved file stays inside ``plsql_source_root``
after symlink resolution. Traversal attempts and oversized files surface as
normalized analysis problems, never as raw paths or bytes (ADR 0012).
"""

from __future__ import annotations

from pathlib import Path

from app.integrations.plsql.errors import (
    PlsqlLimitExceeded,
    PlsqlNotConfigured,
    PlsqlObjectNotFound,
)


def source_root(root: str | None) -> Path:
    """Return the configured read-only source root or fail as unconfigured."""
    if not root:
        raise PlsqlNotConfigured("The PL/SQL source root is not configured.")
    return Path(root)


def resolve_source_file(root: Path, relative_path: str) -> Path:
    """Resolve a project-relative path strictly under ``root``.

    Rejects absolute paths, ``..`` traversal components, paths that escape the
    root after symlink resolution, dangling symlinks, and missing files. All
    rejections raise :class:`PlsqlObjectNotFound` so clients cannot
    distinguish a missing file from a blocked traversal.
    """
    if not relative_path:
        raise PlsqlObjectNotFound("The requested source file is unavailable.")
    candidate = Path(relative_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise PlsqlObjectNotFound("The requested source file is unavailable.")
    resolved_root = root.resolve()
    try:
        resolved = (root / candidate).resolve(strict=True)
    except OSError as exc:
        raise PlsqlObjectNotFound("The requested source file is unavailable.") from exc
    if not resolved.is_relative_to(resolved_root):
        raise PlsqlObjectNotFound("The requested source file is unavailable.")
    return resolved


def read_source_lines(
    resolved: Path, max_bytes: int, encoding: str = "iso-8859-1"
) -> list[str]:
    """Read a resolved file, enforcing the byte cap and decoding text.

    Files are read fully only when they fit within ``max_bytes``; oversized
    files raise :class:`PlsqlLimitExceeded`. ``encoding`` is configurable
    (``PLSQL_SOURCE_ENCODING``, defaulting to ``iso-8859-1``) since analyzed
    PL/SQL corpora are not guaranteed to be UTF-8. Decoding uses replacement
    for determinism, mirroring the read-only text contract.
    """
    try:
        size = resolved.stat().st_size
    except OSError as exc:
        raise PlsqlObjectNotFound("The requested source file is unavailable.") from exc
    if size > max_bytes:
        raise PlsqlLimitExceeded("The source file exceeds the configured byte cap.")
    try:
        raw = resolved.read_bytes()
    except OSError as exc:
        raise PlsqlObjectNotFound("The requested source file is unavailable.") from exc
    return raw.decode(encoding, errors="replace").splitlines()
