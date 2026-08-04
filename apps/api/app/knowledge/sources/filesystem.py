"""Secure, deterministic mixed-format discovery beneath a configured root."""

from __future__ import annotations

import hashlib
import os
import stat
from datetime import UTC, datetime
from pathlib import Path

from app.knowledge.converters import (
    MEDIA_TYPES,
    DocumentConversionError,
    convert_document,
)
from app.knowledge.domain import (
    IngestionCommand,
    KnowledgeDocument,
    KnowledgeSnapshot,
)
from app.knowledge.profiles import (
    DEFAULT_DOCUMENT_PROFILES_JSON,
    DocumentProfiles,
    parse_document_profiles,
)


class SourceValidationError(ValueError):
    """The configured source tree contains an invalid document."""


class SourceLimitError(SourceValidationError):
    """The source snapshot exceeds a configured resource limit."""


class FilesystemDocumentSource:
    def __init__(
        self,
        root: Path | str,
        *,
        max_documents: int = 1_000,
        max_document_bytes: int = 2 * 1024 * 1024,
        max_total_bytes: int = 32 * 1024 * 1024,
        max_extracted_document_bytes: int = 8 * 1024 * 1024,
        profiles: DocumentProfiles | None = None,
    ) -> None:
        self.root = Path(root)
        self.max_documents = max_documents
        self.max_document_bytes = max_document_bytes
        self.max_total_bytes = max_total_bytes
        self.max_extracted_document_bytes = max_extracted_document_bytes
        self.profiles = profiles or parse_document_profiles(
            DEFAULT_DOCUMENT_PROFILES_JSON
        )
        if (
            min(
                max_documents,
                max_document_bytes,
                max_total_bytes,
                max_extracted_document_bytes,
            )
            < 1
        ):
            raise ValueError("Source limits must be positive")

    async def snapshot(self, command: IngestionCommand) -> KnowledgeSnapshot:
        if command.source_type not in (None, "filesystem"):
            raise SourceValidationError(
                "Filesystem source cannot serve the requested source type"
            )
        # Discovery performs bounded local I/O only. Keeping it in this call
        # also avoids retaining raw document bytes in a worker-thread future.
        return self.discover()

    def discover(self) -> KnowledgeSnapshot:
        root = self.root.resolve(strict=True)
        if not root.is_dir():
            raise SourceValidationError("Knowledge source root must be a directory")

        candidates = self._walk(root, root)
        if len(candidates) > self.max_documents:
            raise SourceLimitError("Knowledge document count exceeds configured limit")

        documents: list[KnowledgeDocument] = []
        total = 0
        for path in sorted(candidates, key=lambda item: item.as_posix()):
            relative = path.relative_to(root).as_posix()
            raw = self._read_regular_file(path, root)
            total += len(raw)
            if total > self.max_total_bytes:
                raise SourceLimitError(
                    "Knowledge source bytes exceed configured total limit"
                )
            try:
                converted = convert_document(
                    relative,
                    raw,
                    max_extracted_bytes=self.max_extracted_document_bytes,
                )
            except DocumentConversionError as exc:
                raise SourceValidationError(
                    f"Knowledge document conversion failed: {relative}"
                ) from exc
            profile_name, _ = self.profiles.select(relative)
            documents.append(
                KnowledgeDocument(
                    relative_path=relative,
                    content=converted.text,
                    raw_bytes=raw,
                    sha256=hashlib.sha256(raw).hexdigest(),
                    bytes=len(raw),
                    modified_at=datetime.fromtimestamp(
                        path.stat(follow_symlinks=False).st_mtime, tz=UTC
                    ),
                    media_type=converted.media_type,
                    profile=profile_name,
                    converter=converted.metadata,
                )
            )

        digest = hashlib.sha256()
        for document in documents:
            digest.update(document.relative_path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(document.sha256.encode("ascii"))
            digest.update(b"\0")
        return KnowledgeSnapshot(
            source_version=digest.hexdigest(),
            documents=tuple(documents),
            total_bytes=total,
        )

    def _walk(self, directory: Path, root: Path) -> list[Path]:
        found: list[Path] = []
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as exc:
            raise SourceValidationError("Knowledge source cannot be read") from exc
        for entry in entries:
            if self._ignored(entry.name) or entry.is_symlink():
                continue
            path = Path(entry.path)
            self._assert_contained(path, root)
            if entry.is_dir(follow_symlinks=False):
                found.extend(self._walk(path, root))
            elif (
                entry.is_file(follow_symlinks=False)
                and path.suffix.lower() in MEDIA_TYPES
            ):
                found.append(path)
                if len(found) > self.max_documents:
                    raise SourceLimitError(
                        "Knowledge document count exceeds configured limit"
                    )
        return found

    def _read_regular_file(self, path: Path, root: Path) -> bytes:
        self._assert_contained(path, root)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError as exc:
            raise SourceValidationError("Knowledge document cannot be opened") from exc
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise SourceValidationError("Knowledge document is not a regular file")
            if metadata.st_size == 0:
                raise SourceValidationError("Knowledge documents must not be empty")
            if metadata.st_size > self.max_document_bytes:
                raise SourceLimitError(
                    "Knowledge document exceeds configured size limit"
                )
            chunks: list[bytes] = []
            remaining = self.max_document_bytes + 1
            while remaining:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
            if len(raw) > self.max_document_bytes:
                raise SourceLimitError(
                    "Knowledge document exceeds configured size limit"
                )
            return raw
        finally:
            os.close(descriptor)

    @staticmethod
    def _assert_contained(path: Path, root: Path) -> None:
        resolved = path.resolve(strict=False)
        if resolved != root and root not in resolved.parents:
            raise SourceValidationError("Knowledge document escaped configured root")

    @staticmethod
    def _ignored(name: str) -> bool:
        lower = name.lower()
        return (
            name.startswith(".")
            or name.startswith("#")
            or name.endswith("~")
            or lower.endswith((".tmp", ".temp", ".swp", ".bak"))
        )
