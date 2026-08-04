from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

from amiba_backplane.runtime.features.hermes_proxy.kanban import service


@dataclass
class FakeTask:
    id: str = "task-1"
    title: str = "Research"
    status: str = "ready"
    workspace_kind: str = "dir"
    workspace_path: str | None = None


def test_empty_board_does_not_initialize_the_kanban_database(
    monkeypatch, tmp_path
):
    missing = tmp_path / "missing.db"
    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        kanban_db_path=lambda board: missing,
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    result = service.list_tasks_response()

    assert result == {
        "ok": True,
        "board": "current",
        "tasks": [],
        "counts": {},
    }


def test_created_tasks_default_to_the_amiba_home_workspace(monkeypatch):
    captured = {}

    @contextmanager
    def connection(*, board):
        captured["board"] = board
        yield object()

    def create_task(_conn, **kwargs):
        captured["kwargs"] = kwargs
        return "task-1"

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        create_task=create_task,
        get_task=lambda _conn, _task_id: FakeTask(
            workspace_path=str(Path.home())
        ),
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    result = service.create_task_response({"title": "Research"})

    assert result["ok"] is True
    assert captured["board"] == "current"
    assert captured["kwargs"]["workspace_kind"] == "dir"
    assert captured["kwargs"]["workspace_path"] == str(Path.home())
    assert captured["kwargs"]["board"] == "current"
