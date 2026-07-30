"""Advisory process-safe lock backed by POSIX flock."""

from __future__ import annotations

import fcntl
import os
import time
from pathlib import Path
from types import TracebackType


class LockTimeoutError(TimeoutError):
    pass


class ProcessFileLock:
    def __init__(self, path: Path | str, *, timeout_seconds: float = 10.0) -> None:
        self.path = Path(path)
        self.timeout_seconds = timeout_seconds
        self._descriptor: int | None = None
        if timeout_seconds < 0:
            raise ValueError("Lock timeout must not be negative")

    def __enter__(self) -> ProcessFileLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self._descriptor = descriptor
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    os.close(descriptor)
                    raise LockTimeoutError(
                        "Timed out acquiring knowledge state lock"
                    ) from None
                time.sleep(0.01)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc, traceback
        if self._descriptor is not None:
            fcntl.flock(self._descriptor, fcntl.LOCK_UN)
            os.close(self._descriptor)
            self._descriptor = None
