"""Bounded local upload storage with content-addressed immutable blobs."""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import tempfile
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request

from app.knowledge.converters import (
    MEDIA_TYPES,
    DocumentConversionError,
    convert_document,
)

from .repository import PartRecord, ProjectConflict, ProjectRepository


class UploadValidationError(ValueError):
    pass


def validate_filename(filename: str) -> str:
    if (
        not filename
        or filename in {".", ".."}
        or filename != filename.strip()
        or "/" in filename
        or "\\" in filename
        or len(filename.encode("utf-8")) > 255
        or unicodedata.normalize("NFC", filename) != filename
        or any(
            unicodedata.category(character).startswith("C") for character in filename
        )
    ):
        raise UploadValidationError("The filename is invalid")
    if Path(filename).suffix.lower() not in MEDIA_TYPES:
        raise UploadValidationError("The file format is unsupported")
    return filename


class ProjectStorage:
    def __init__(
        self,
        root: str | Path,
        *,
        max_file_bytes: int,
        max_extracted_bytes: int,
        max_files: int = 100,
        max_total_bytes: int = 32 * 1024 * 1024,
    ) -> None:
        self.root = Path(root)
        self.max_file_bytes = max_file_bytes
        self.max_extracted_bytes = max_extracted_bytes
        self.max_files = max_files
        self.max_total_bytes = max_total_bytes

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    async def receive_part(
        self,
        repository: ProjectRepository,
        part: PartRecord,
        request: Request,
    ) -> None:
        if part.state != "pending":
            raise ProjectConflict("The upload part is no longer writable")
        if part.expires_at <= datetime.now(UTC):
            raise ProjectConflict("The upload session expired")
        if part.expected_size > self.max_file_bytes:
            raise UploadValidationError("The file exceeds the configured size limit")
        temporary_dir = self.root / part.project_id / "uploads" / part.session_id
        temporary_dir.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(
            dir=temporary_dir, prefix=f".{part.id}.", suffix=".part"
        )
        digest = hashlib.sha256()
        received = 0
        try:
            try:
                os.fchmod(descriptor, 0o600)
                async for chunk in request.stream():
                    if not chunk:
                        continue
                    received += len(chunk)
                    if received > part.expected_size or received > self.max_file_bytes:
                        raise UploadValidationError("The uploaded byte size is invalid")
                    digest.update(chunk)
                    await asyncio.to_thread(_write_all, descriptor, chunk)
                await asyncio.to_thread(os.fsync, descriptor)
            finally:
                os.close(descriptor)
        except BaseException:
            await asyncio.to_thread(Path(temporary).unlink, missing_ok=True)
            raise
        if received != part.expected_size or digest.hexdigest() != part.expected_sha256:
            await asyncio.to_thread(Path(temporary).unlink, missing_ok=True)
            raise UploadValidationError(
                "The uploaded checksum or byte size does not match"
            )
        await repository.mark_part_uploaded(part.id, temporary, received)

    async def validate_and_store(
        self, repository: ProjectRepository, project_id: str, session_id: str
    ) -> list[tuple[str, str]]:
        upload = await repository.get_upload_session(project_id, session_id)
        if upload.state == "finalized":
            return []
        if upload.state != "open" or (
            upload.expires_at
            if upload.expires_at.tzinfo
            else upload.expires_at.replace(tzinfo=UTC)
        ) <= datetime.now(UTC):
            raise ProjectConflict("The upload session is not open")
        existing = await repository.list_files(project_id)
        by_name = {item.logical_filename: item for item in existing}
        declared_names = [part.logical_filename for part in upload.parts]
        final_count = len((set(by_name) - set(declared_names)) | set(declared_names))
        if final_count > self.max_files:
            raise UploadValidationError(
                "The project exceeds the configured file-count limit"
            )
        final_total = sum(
            item.size for name, item in by_name.items() if name not in declared_names
        )
        final_total += sum(part.expected_size for part in upload.parts)
        if final_total > self.max_total_bytes:
            raise UploadValidationError(
                "The project exceeds the configured aggregate-size limit"
            )

        stored: list[tuple[str, str]] = []
        for part in upload.parts:
            validate_filename(part.logical_filename)
            if part.state != "uploaded" or not part.temp_path:
                raise ProjectConflict("All upload parts must be uploaded")
            temporary = Path(part.temp_path)
            raw = await asyncio.to_thread(temporary.read_bytes)
            if (
                len(raw) != part.expected_size
                or hashlib.sha256(raw).hexdigest() != part.expected_sha256
            ):
                raise UploadValidationError(
                    "An uploaded part failed final verification"
                )
            try:
                convert_document(
                    part.logical_filename,
                    raw,
                    max_extracted_bytes=self.max_extracted_bytes,
                )
            except DocumentConversionError as exc:
                raise UploadValidationError("The uploaded document is invalid") from exc
            blob_dir = self.root / project_id / "blobs"
            blob_dir.mkdir(parents=True, exist_ok=True)
            target = blob_dir / part.expected_sha256
            if target.exists():
                await asyncio.to_thread(temporary.unlink, missing_ok=True)
            else:
                os.replace(temporary, target)
                target.chmod(0o600)
            stored.append((part.id, str(target)))
        return stored

    async def cleanup_paths(self, paths: list[str]) -> None:
        for path in paths:
            await asyncio.to_thread(Path(path).unlink, missing_ok=True)

    async def purge_project(self, project_id: str) -> None:
        target = (self.root / project_id).resolve()
        root = self.root.resolve()
        if target.parent != root:
            raise ValueError("Project storage path is invalid")
        if target.exists():
            await asyncio.to_thread(shutil.rmtree, target)


def _write_all(descriptor: int, content: bytes) -> None:
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            raise OSError("Upload temporary file write failed")
        offset += written
