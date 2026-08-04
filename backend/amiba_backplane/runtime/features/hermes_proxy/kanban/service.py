from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Optional


def _kanban():
    from hermes_cli import kanban_db as kb  # type: ignore

    return kb


def _task_payload(task: Any, *, latest_summary: Optional[str], parents: list[str]) -> Dict[str, Any]:
    payload = asdict(task)
    # Runtime coordination fields are useful to Hermes but noisy and unsafe as
    # a public UI contract. Keep only user-facing execution state.
    for key in (
        "claim_lock",
        "claim_expires",
        "worker_pid",
        "current_run_id",
        "last_heartbeat_at",
    ):
        payload.pop(key, None)
    payload["latest_summary"] = latest_summary
    payload["parents"] = parents
    return payload


def list_boards_response() -> Dict[str, Any]:
    kb = _kanban()
    current = kb.get_current_board()
    boards = kb.list_boards(include_archived=False)
    for board in boards:
        slug = board["slug"]
        path = kb.kanban_db_path(board=slug)
        counts: Dict[str, int] = {}
        if path.exists() and path.stat().st_size > 0:
            with kb.connect_closing(board=slug) as conn:
                counts = dict(kb.board_stats(conn).get("by_status") or {})
        board["counts"] = counts
        board["total"] = sum(counts.values())
        board["is_current"] = slug == current
    return {"ok": True, "boards": boards, "current": current}


def list_tasks_response(
    *,
    board: Optional[str] = None,
    session_id: Optional[str] = None,
    include_archived: bool = False,
) -> Dict[str, Any]:
    kb = _kanban()
    board = board or kb.get_current_board()
    path = kb.kanban_db_path(board=board)
    if not path.exists() or path.stat().st_size == 0:
        return {"ok": True, "board": board, "tasks": [], "counts": {}}
    with kb.connect_closing(board=board) as conn:
        tasks = kb.list_tasks(
            conn,
            session_id=session_id or None,
            include_archived=include_archived,
            order_by="created-desc",
        )
        summaries = kb.latest_summaries(conn, [task.id for task in tasks])
        items = [
            _task_payload(
                task,
                latest_summary=summaries.get(task.id),
                parents=kb.parent_ids(conn, task.id),
            )
            for task in tasks
        ]
        counts: Dict[str, int] = {}
        for task in tasks:
            counts[task.status] = counts.get(task.status, 0) + 1
    return {"ok": True, "board": board, "tasks": items, "counts": counts}


def create_task_response(
    body: Dict[str, Any],
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = board or kb.get_current_board()
    title = str(body.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    workdir = str(body.get("workspace_path") or "").strip() or str(Path.home())
    assignee = str(body.get("assignee") or "").strip() or None
    session_id = str(body.get("session_id") or "").strip() or None
    priority = int(body.get("priority") or 0)
    with kb.connect_closing(board=board) as conn:
        task_id = kb.create_task(
            conn,
            title=title,
            body=str(body.get("body") or "").strip() or None,
            assignee=assignee,
            created_by="amiba",
            workspace_kind="dir",
            workspace_path=workdir,
            priority=priority,
            triage=bool(body.get("triage", False)),
            session_id=session_id,
            board=board,
        )
        task = kb.get_task(conn, task_id)
        if task is None:
            raise RuntimeError("Hermes created the task but it could not be read back")
        payload = _task_payload(task, latest_summary=None, parents=[])
    return {"ok": True, "task": payload}
