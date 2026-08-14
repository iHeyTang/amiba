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
    claim_lock: str | None = None
    claim_expires: int | None = None
    worker_pid: int | None = None
    current_run_id: int | None = None
    last_heartbeat_at: int | None = None


@dataclass
class FakeComment:
    id: int = 1
    task_id: str = "task-1"
    author: str = "amiba"
    body: str = "Check the result"
    created_at: int = 10


@dataclass
class FakeAttachment:
    id: int = 1
    task_id: str = "task-1"
    filename: str = "result.txt"
    stored_path: str = "/private/result.txt"
    content_type: str | None = "text/plain"
    size: int = 12
    uploaded_by: str | None = "amiba"
    created_at: int = 11


@dataclass
class FakeRun:
    id: int = 1
    task_id: str = "task-1"
    status: str = "completed"
    claim_lock: str | None = "secret-run-lock"
    claim_expires: int | None = 99
    summary: str | None = "Delivered"


@dataclass
class FakeEvent:
    id: int = 1
    task_id: str = "task-1"
    kind: str = "completed"
    payload: dict | None = None
    created_at: int = 12
    run_id: int | None = 1


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

    def add_comment(_conn, task_id, *, author, body):
        captured["comment"] = {
            "task_id": task_id,
            "author": author,
            "body": body,
        }

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        create_task=create_task,
        add_comment=add_comment,
        get_task=lambda _conn, _task_id: FakeTask(
            workspace_path=str(Path.home())
        ),
        parent_ids=lambda _conn, _task_id: [],
        child_ids=lambda _conn, _task_id: [],
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    result = service.create_task_response({"title": "Research"})

    assert result["ok"] is True
    assert captured["board"] == "current"
    assert captured["kwargs"]["workspace_kind"] == "dir"
    assert captured["kwargs"]["workspace_path"] == str(Path.home())
    assert captured["kwargs"]["board"] == "current"
    assert captured["comment"]["task_id"] == "task-1"
    assert captured["comment"]["author"] == "amiba-orchestrator"
    assert "decide whether" in captured["comment"]["body"]
    assert "kanban_create" in captured["comment"]["body"]
    assert "fixed parallel/verify/synthesize" in captured["comment"]["body"]


def test_create_forwards_dependencies_and_worker_configuration(monkeypatch):
    captured = {}

    @contextmanager
    def connection(*, board):
        yield object()

    def create_task(_conn, **kwargs):
        captured.update(kwargs)
        return "task-1"

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        create_task=create_task,
        get_task=lambda _conn, _task_id: FakeTask(),
        parent_ids=lambda _conn, _task_id: ["task-parent"],
        child_ids=lambda _conn, _task_id: [],
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    result = service.create_task_response(
        {
            "title": "Research",
            "parents": ["task-parent"],
            "skills": ["browser"],
            "model_override": "model-x",
            "provider_override": "provider-x",
        }
    )

    assert captured["parents"] == ["task-parent"]
    assert captured["skills"] == ["browser"]
    assert captured["model_override"] == "model-x"
    assert captured["provider_override"] == "provider-x"
    assert result["task"]["parents"] == ["task-parent"]


def test_task_detail_includes_collaboration_history_without_claim_secrets(
    monkeypatch,
):
    @contextmanager
    def connection(*, board):
        yield object()

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        get_task=lambda _conn, _task_id: FakeTask(
            claim_lock="secret-task-lock",
            claim_expires=88,
            worker_pid=123,
            current_run_id=1,
            last_heartbeat_at=77,
        ),
        latest_summary=lambda _conn, _task_id: "Delivered",
        parent_ids=lambda _conn, _task_id: ["parent-1"],
        child_ids=lambda _conn, _task_id: ["child-1"],
        list_comments=lambda _conn, _task_id: [
            FakeComment(),
            FakeComment(id=2, author="amiba-orchestrator", body="internal"),
        ],
        list_attachments=lambda _conn, _task_id: [FakeAttachment()],
        list_runs=lambda _conn, _task_id: [FakeRun()],
        list_events=lambda _conn, _task_id: [FakeEvent()],
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    result = service.get_task_response("task-1")

    assert result["task"]["parents"] == ["parent-1"]
    assert result["task"]["children"] == ["child-1"]
    assert result["task"]["worker_pid"] == 123
    assert "claim_lock" not in result["task"]
    assert "stored_path" not in result["attachments"][0]
    assert "claim_lock" not in result["runs"][0]
    assert result["comments"][0]["body"] == "Check the result"
    assert len(result["comments"]) == 1
    assert result["events"][0]["kind"] == "completed"


def test_block_action_uses_hermes_lifecycle_transition(monkeypatch):
    captured = {}

    @contextmanager
    def connection(*, board):
        yield object()

    def block_task(_conn, task_id, *, reason, kind):
        captured.update(task_id=task_id, reason=reason, kind=kind)
        return True

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        get_task=lambda _conn, _task_id: FakeTask(status="ready"),
        block_task=block_task,
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)
    monkeypatch.setattr(service, "_detail_payload", lambda *_args: {"task": {}})

    result = service.task_action_response(
        "task-1",
        {"action": "block", "reason": "Needs approval", "kind": "needs_input"},
    )

    assert result["ok"] is True
    assert captured == {
        "task_id": "task-1",
        "reason": "Needs approval",
        "kind": "needs_input",
    }


def test_request_changes_is_only_valid_during_review(monkeypatch):
    @contextmanager
    def connection(*, board):
        yield object()

    fake = SimpleNamespace(
        get_current_board=lambda: "current",
        connect_closing=connection,
        get_task=lambda _conn, _task_id: FakeTask(status="ready"),
    )
    monkeypatch.setattr(service, "_kanban", lambda: fake)

    try:
        service.task_action_response(
            "task-1", {"action": "request_changes", "reason": "Fix tests"}
        )
    except ValueError as exc:
        assert "during review" in str(exc)
    else:
        raise AssertionError("request_changes should reject non-review tasks")
