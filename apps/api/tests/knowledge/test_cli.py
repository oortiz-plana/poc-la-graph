from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from app.knowledge import cli


class CliSettings:
    knowledge_ingest_on_startup = True
    knowledge_force_rebuild = True


class CliService:
    instances: list[CliService] = []
    graph_state = "ready"

    def __init__(self, settings: Any, logger: Any) -> None:
        del settings, logger
        self._task: asyncio.Task[None] | None = None
        self.maybe_startup_calls = 0
        self.manual_forces: list[bool] = []
        self.instances.append(self)

    async def maybe_startup(self) -> None:
        self.maybe_startup_calls += 1

        async def finish() -> None:
            await asyncio.sleep(0)

        self._task = asyncio.create_task(finish())

    async def run_now(self, *, force: bool = False) -> str:
        self.manual_forces.append(force)
        return "job"

    def graph_status(self) -> dict[str, Any]:
        return {"status": self.graph_state, "activeGraphVersion": "v1"}


@pytest.fixture(autouse=True)
def fake_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    CliService.instances.clear()
    CliService.graph_state = "ready"
    monkeypatch.setattr(cli, "Settings", CliSettings)
    monkeypatch.setattr(cli, "KnowledgeIngestionService", CliService)


async def test_startup_reconciles_waits_and_requires_active_graph(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr("sys.argv", ["knowledge", "startup"])
    assert await cli._main() == 0
    service = CliService.instances[-1]
    assert service.maybe_startup_calls == 1
    assert service._task is not None and service._task.done()
    assert json.loads(capsys.readouterr().out)["status"] == "ready"


async def test_startup_fails_without_valid_active_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    CliService.graph_state = "unavailable"
    monkeypatch.setattr("sys.argv", ["knowledge", "startup"])
    assert await cli._main() == 1


@pytest.mark.parametrize(
    ("arguments", "expected_force"),
    [
        (["knowledge", "ingest"], False),
        (["knowledge", "ingest", "--force"], True),
    ],
)
async def test_manual_ingest_ignores_startup_flags_and_force_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
    arguments: list[str],
    expected_force: bool,
) -> None:
    monkeypatch.setattr("sys.argv", arguments)
    assert await cli._main() == 0
    service = CliService.instances[-1]
    assert service.maybe_startup_calls == 0
    assert service.manual_forces == [expected_force]
