"""Atomic JSON repositories for immutable manifests and mutable state pointers."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.knowledge.domain import ActivePointer, BuildFailure, GraphBuildManifest

from .lock import ProcessFileLock


class ImmutableManifestError(RuntimeError):
    pass


class GenerationConflictError(RuntimeError):
    pass


class KnowledgeStateRepository:
    def __init__(self, project_root: Path | str) -> None:
        self.root = Path(project_root)
        self.versions = self.root / "versions"
        self.lock_path = self.root / ".state.lock"

    def save_manifest(self, manifest: GraphBuildManifest) -> Path:
        target = self.versions / manifest.graph_version / "manifest.json"
        with ProcessFileLock(self.lock_path):
            if target.exists():
                current = self.load_manifest(manifest.graph_version)
                if current != manifest:
                    raise ImmutableManifestError(
                        "Published graph manifest cannot be changed"
                    )
                return target
            self._atomic_write(target, manifest)
        return target

    def load_manifest(self, graph_version: str) -> GraphBuildManifest:
        return GraphBuildManifest.model_validate_json(
            self._read_regular(self.versions / graph_version / "manifest.json")
        )

    def load_active(self) -> ActivePointer | None:
        target = self.root / "active.json"
        if not target.exists():
            return None
        return ActivePointer.model_validate_json(self._read_regular(target))

    def compare_and_set_active(
        self, pointer: ActivePointer, *, expected_generation: int
    ) -> None:
        with ProcessFileLock(self.lock_path):
            current = self.load_active()
            generation = current.generation if current else 0
            if generation != expected_generation:
                raise GenerationConflictError("Active graph generation changed")
            if pointer.generation != expected_generation + 1:
                raise GenerationConflictError(
                    "Next active graph generation must increment by one"
                )
            manifest = self.load_manifest(pointer.graph_version)
            if manifest.project_id != pointer.project_id:
                raise ValueError("Active pointer project does not match manifest")
            self._atomic_write(self.root / "active.json", pointer)

    def save_failure(self, failure: BuildFailure) -> None:
        with ProcessFileLock(self.lock_path):
            self._atomic_write(self.root / "failure.json", failure)

    def load_failure(self) -> BuildFailure | None:
        target = self.root / "failure.json"
        if not target.exists():
            return None
        return BuildFailure.model_validate_json(self._read_regular(target))

    def clear_failure(self) -> None:
        with ProcessFileLock(self.lock_path):
            target = self.root / "failure.json"
            if target.exists():
                target.unlink()
                self._fsync_directory(target.parent)

    @staticmethod
    def _read_regular(path: Path) -> bytes:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        try:
            metadata = os.fstat(descriptor)
            if not os.path.isfile(path) or metadata.st_size > 1024 * 1024:
                raise ValueError("Knowledge state file is invalid")
            return os.read(descriptor, metadata.st_size + 1)
        finally:
            os.close(descriptor)

    def _atomic_write(self, target: Path, value: BaseModel | dict[str, Any]) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = (
            value.model_dump(mode="json", by_alias=True)
            if isinstance(value, BaseModel)
            else value
        )
        encoded = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        descriptor, temporary = tempfile.mkstemp(
            dir=target.parent, prefix=f".{target.name}.", suffix=".tmp"
        )
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb", closefd=True) as output:
                output.write(encoded)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
            self._fsync_directory(target.parent)
        except BaseException:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
