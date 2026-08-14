from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


def _kanban():
    from hermes_cli import kanban_db as kb  # type: ignore

    return kb


_ORCHESTRATION_AUTHOR = "amiba-orchestrator"
_ORCHESTRATION_GUIDANCE = """[amiba:orchestration]
You own this top-level goal. Before doing the work, decide whether it is best handled as one task or decomposed into a task graph.

- If it is one coherent unit of work, execute it directly and complete this task normally.
- If decomposition would improve speed, specialization, or verification, inspect the available profiles and use `kanban_create` to create concrete child tasks. Assign only real profiles, express ordering with `parents`, and choose the graph that fits this goal; do not assume a fixed parallel/verify/synthesize topology.
- After creating child tasks, complete this planning task with a concise decomposition summary and the created task IDs. Do not duplicate the child work yourself.
"""


def _task_payload(
    task: Any,
    *,
    latest_summary: Optional[str],
    parents: list[str],
    children: Optional[list[str]] = None,
    include_runtime: bool = False,
) -> Dict[str, Any]:
    payload = asdict(task)
    # Claim tokens are internal coordination secrets. Runtime liveness fields
    # are useful in the task inspector, but are omitted from board cards.
    for key in ("claim_lock", "claim_expires"):
        payload.pop(key, None)
    if not include_runtime:
        for key in ("worker_pid", "current_run_id", "last_heartbeat_at"):
            payload.pop(key, None)
    payload["latest_summary"] = latest_summary
    payload["parents"] = parents
    payload["children"] = children or []
    return payload


def _public_payload(value: Any, *, hidden: Iterable[str] = ()) -> Dict[str, Any]:
    payload = asdict(value)
    for key in hidden:
        payload.pop(key, None)
    return payload


def _board_name(kb: Any, board: Optional[str]) -> str:
    return board or kb.get_current_board()


def _task_or_error(kb: Any, conn: Any, task_id: str) -> Any:
    task = kb.get_task(conn, task_id)
    if task is None:
        raise ValueError(f"unknown task {task_id}")
    return task


def _detail_payload(kb: Any, conn: Any, task: Any) -> Dict[str, Any]:
    attachments = [
        _public_payload(item, hidden=("stored_path",))
        for item in kb.list_attachments(conn, task.id)
    ]
    runs = [
        _public_payload(item, hidden=("claim_lock", "claim_expires"))
        for item in kb.list_runs(conn, task.id)
    ]
    return {
        "task": _task_payload(
            task,
            latest_summary=kb.latest_summary(conn, task.id),
            parents=kb.parent_ids(conn, task.id),
            children=kb.child_ids(conn, task.id),
            include_runtime=True,
        ),
        "comments": [
            _public_payload(item)
            for item in kb.list_comments(conn, task.id)
            if item.author != _ORCHESTRATION_AUTHOR
        ],
        "attachments": attachments,
        "runs": runs,
        "events": [_public_payload(item) for item in kb.list_events(conn, task.id)],
    }


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
                children=kb.child_ids(conn, task.id),
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
    if priority < 0 or priority > 9:
        raise ValueError("priority must be between 0 and 9")
    raw_parents = body.get("parents") or []
    if not isinstance(raw_parents, list):
        raise ValueError("parents must be a list")
    parents = [str(item).strip() for item in raw_parents if str(item).strip()]
    raw_skills = body.get("skills")
    if raw_skills is not None and not isinstance(raw_skills, list):
        raise ValueError("skills must be a list")
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
            parents=parents,
            triage=bool(body.get("triage", False)),
            skills=raw_skills,
            model_override=str(body.get("model_override") or "").strip() or None,
            provider_override=str(body.get("provider_override") or "").strip() or None,
            session_id=session_id,
            board=board,
        )
        orchestration = bool(body.get("orchestration", not parents))
        if orchestration and not parents:
            kb.add_comment(
                conn,
                task_id,
                author=_ORCHESTRATION_AUTHOR,
                body=_ORCHESTRATION_GUIDANCE,
            )
        task = kb.get_task(conn, task_id)
        if task is None:
            raise RuntimeError("Hermes created the task but it could not be read back")
        payload = _task_payload(
            task,
            latest_summary=None,
            parents=kb.parent_ids(conn, task.id),
            children=kb.child_ids(conn, task.id),
        )
    return {"ok": True, "task": payload}


def get_task_response(task_id: str, *, board: Optional[str] = None) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def update_task_response(
    task_id: str,
    body: Dict[str, Any],
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    editable = {"title", "body", "priority", "workspace_path"}
    unknown = set(body) - editable - {"assignee", "reclaim_running"}
    if unknown:
        raise ValueError(f"unsupported task field(s): {', '.join(sorted(unknown))}")

    with kb.connect_closing(board=board) as conn:
        current = _task_or_error(kb, conn, task_id)
        if current.status == "archived":
            raise ValueError("archived tasks cannot be edited")
        if current.status == "running" and any(
            key in body for key in ("workspace_path",)
        ):
            raise ValueError("a running task's workspace cannot be changed")

        updates: list[str] = []
        values: list[Any] = []
        changed: list[str] = []
        if "title" in body:
            title = str(body.get("title") or "").strip()
            if not title:
                raise ValueError("title is required")
            updates.append("title = ?")
            values.append(title)
            changed.append("title")
        if "body" in body:
            updates.append("body = ?")
            values.append(str(body.get("body") or "").strip() or None)
            changed.append("body")
        if "priority" in body:
            priority = int(body.get("priority") or 0)
            if priority < 0 or priority > 9:
                raise ValueError("priority must be between 0 and 9")
            updates.append("priority = ?")
            values.append(priority)
            changed.append("priority")
        if "workspace_path" in body:
            workspace_path = str(body.get("workspace_path") or "").strip()
            if not workspace_path:
                raise ValueError("workspace_path is required")
            updates.extend(("workspace_kind = ?", "workspace_path = ?"))
            values.extend(("dir", workspace_path))
            changed.append("workspace_path")

        if updates:
            with kb.write_txn(conn):
                conn.execute(
                    f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?",
                    (*values, task_id),
                )
                kb._append_event(  # type: ignore[attr-defined]
                    conn, task_id, "edited", {"fields": changed, "actor": "amiba"}
                )

        if "assignee" in body:
            assignee = str(body.get("assignee") or "").strip() or None
            landed = kb.reassign_task(
                conn,
                task_id,
                assignee,
                reclaim_first=bool(body.get("reclaim_running", False)),
                reason="reassigned from Amiba",
            )
            if not landed:
                raise ValueError("running task must be stopped before reassignment")

        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def _manual_status(
    kb: Any,
    conn: Any,
    task_id: str,
    status: str,
    *,
    event: str,
    payload: Optional[Dict[str, Any]] = None,
    clear_result: bool = False,
) -> None:
    with kb.write_txn(conn):
        conn.execute(
            "UPDATE tasks SET status = ?, claim_lock = NULL, claim_expires = NULL, "
            "worker_pid = NULL, current_run_id = NULL, "
            "result = CASE WHEN ? THEN NULL ELSE result END, "
            "completed_at = CASE WHEN ? = 'done' THEN strftime('%s','now') ELSE NULL END "
            "WHERE id = ?",
            (status, clear_result, status, task_id),
        )
        kb._append_event(conn, task_id, event, payload or {"actor": "amiba"})  # type: ignore[attr-defined]


def task_action_response(
    task_id: str,
    body: Dict[str, Any],
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    action = str(body.get("action") or "").strip()
    if not action:
        raise ValueError("action is required")

    with kb.connect_closing(board=board) as conn:
        task = _task_or_error(kb, conn, task_id)
        ok = True
        if action == "block":
            if task.status in {"done", "archived"}:
                raise ValueError(f"task in {task.status} cannot be blocked")
            reason = str(body.get("reason") or "").strip() or None
            kind = str(body.get("kind") or "").strip() or "needs_input"
            if kind not in {"dependency", "needs_input", "capability", "transient"}:
                raise ValueError("unsupported block kind")
            if task.status in {"ready", "running"}:
                ok = kb.block_task(
                    conn,
                    task_id,
                    reason=reason,
                    kind=kind,
                )
            else:
                _manual_status(
                    kb,
                    conn,
                    task_id,
                    "blocked",
                    event="blocked",
                    payload={"actor": "amiba", "reason": reason, "kind": kind},
                )
                if reason:
                    kb.add_comment(conn, task_id, "amiba", reason)
        elif action == "unblock":
            ok = kb.unblock_task(conn, task_id)
        elif action == "retry":
            if task.status == "running":
                ok = kb.reclaim_task(
                    conn, task_id, reason=str(body.get("reason") or "manual retry")
                )
            elif task.status in {"blocked", "scheduled"}:
                ok = kb.unblock_task(conn, task_id)
            elif task.status == "todo":
                ok, reason = kb.promote_task(
                    conn,
                    task_id,
                    actor="amiba",
                    reason=str(body.get("reason") or "manual retry"),
                    force=bool(body.get("force", False)),
                )
                if not ok and reason:
                    raise ValueError(reason)
            elif task.status == "archived":
                raise ValueError("archived tasks cannot be retried")
            else:
                _manual_status(
                    kb,
                    conn,
                    task_id,
                    "ready",
                    event="retried",
                    payload={"actor": "amiba", "from": task.status},
                    clear_result=True,
                )
        elif action == "complete":
            summary = str(body.get("summary") or body.get("result") or "").strip()
            if task.status in {"ready", "running"}:
                ok = kb.complete_task(
                    conn,
                    task_id,
                    result=str(body.get("result") or "").strip() or summary or None,
                    summary=summary or None,
                )
            elif task.status == "review":
                _manual_status(
                    kb,
                    conn,
                    task_id,
                    "done",
                    event="review_approved",
                    payload={"actor": "amiba", "summary": summary or None},
                )
                if summary:
                    kb.edit_completed_task_result(
                        conn,
                        task_id,
                        result=str(body.get("result") or "").strip() or summary,
                        summary=summary,
                    )
                    kb.add_comment(conn, task_id, "amiba", summary)
            else:
                raise ValueError(f"task in {task.status} cannot be completed")
        elif action == "request_review":
            if task.status == "running":
                raise ValueError("stop the running task before requesting review")
            if task.status in {"done", "archived"}:
                raise ValueError(f"task in {task.status} cannot request review")
            reviewer = str(body.get("reviewer") or "").strip() or task.assignee
            _manual_status(
                kb,
                conn,
                task_id,
                "review",
                event="review_requested",
                payload={"actor": "amiba", "reviewer": reviewer},
            )
            if reviewer != task.assignee:
                kb.assign_task(conn, task_id, reviewer)
            summary = str(body.get("summary") or "").strip()
            if summary:
                kb.add_comment(conn, task_id, "amiba", summary)
        elif action == "request_changes":
            if task.status != "review":
                raise ValueError("changes can only be requested during review")
            reason = str(body.get("reason") or "").strip()
            if not reason:
                raise ValueError("reason is required")
            target = "todo" if any(
                parent.status not in {"done", "archived"}
                for parent in (
                    kb.get_task(conn, parent_id)
                    for parent_id in kb.parent_ids(conn, task_id)
                )
                if parent is not None
            ) else "ready"
            _manual_status(
                kb,
                conn,
                task_id,
                target,
                event="changes_requested",
                payload={"actor": "amiba", "reason": reason},
                clear_result=True,
            )
            assignee = str(body.get("assignee") or "").strip() or None
            if assignee:
                kb.assign_task(conn, task_id, assignee)
            kb.add_comment(conn, task_id, "amiba", reason)
        elif action == "move":
            target = str(body.get("status") or "").strip()
            if target == "ready":
                if task.status == "running":
                    ok = kb.reclaim_task(
                        conn, task_id, reason="moved to ready from Amiba"
                    )
                elif task.status in {"blocked", "scheduled"}:
                    ok = kb.unblock_task(conn, task_id)
                elif task.status == "todo":
                    ok, reason = kb.promote_task(
                        conn,
                        task_id,
                        actor="amiba",
                        reason="moved on task board",
                        force=bool(body.get("force", False)),
                    )
                    if not ok and reason:
                        raise ValueError(reason)
                else:
                    _manual_status(
                        kb,
                        conn,
                        task_id,
                        "ready",
                        event="moved",
                        clear_result=task.status == "done",
                    )
            elif target == "blocked":
                reason = str(
                    body.get("reason") or "Moved to needs attention"
                ).strip()
                if task.status in {"ready", "running"}:
                    ok = kb.block_task(
                        conn,
                        task_id,
                        reason=reason,
                        kind="needs_input",
                    )
                elif task.status not in {"done", "archived"}:
                    _manual_status(
                        kb,
                        conn,
                        task_id,
                        "blocked",
                        event="blocked",
                        payload={
                            "actor": "amiba",
                            "reason": reason,
                            "kind": "needs_input",
                        },
                    )
                else:
                    raise ValueError(f"task in {task.status} cannot be blocked")
            elif target == "done":
                if task.status in {"ready", "running"}:
                    ok = kb.complete_task(
                        conn, task_id, summary="Marked complete in Amiba"
                    )
                else:
                    _manual_status(kb, conn, task_id, "done", event="completed_manual")
                    kb.edit_completed_task_result(
                        conn,
                        task_id,
                        result="Marked complete in Amiba",
                        summary="Marked complete in Amiba",
                    )
            elif target in {"triage", "todo", "review"}:
                if task.status == "running":
                    raise ValueError("stop the running task before moving it")
                _manual_status(
                    kb,
                    conn,
                    task_id,
                    target,
                    event="moved",
                    clear_result=task.status == "done" and target != "review",
                )
            else:
                raise ValueError("unsupported target status")
        elif action == "archive":
            ok = kb.archive_task(conn, task_id)
        else:
            raise ValueError(f"unsupported action {action}")

        if not ok:
            raise ValueError(f"action {action} is not valid for task state {task.status}")
        updated = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, updated)
    return {"ok": True, "board": board, **detail}


def delete_task_response(task_id: str, *, board: Optional[str] = None) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        _task_or_error(kb, conn, task_id)
        if not kb.delete_task(conn, task_id):
            raise ValueError(f"unknown task {task_id}")
    return {"ok": True, "board": board, "deleted": task_id}


def add_comment_response(
    task_id: str,
    body: Dict[str, Any],
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    author = str(body.get("author") or "amiba").strip() or "amiba"
    comment_body = str(body.get("body") or "").strip()
    with kb.connect_closing(board=board) as conn:
        kb.add_comment(conn, task_id, author, comment_body)
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def add_dependency_response(
    task_id: str,
    body: Dict[str, Any],
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    parent_id = str(body.get("parent_id") or "").strip()
    if not parent_id:
        raise ValueError("parent_id is required")
    with kb.connect_closing(board=board) as conn:
        kb.link_tasks(conn, parent_id, task_id)
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def remove_dependency_response(
    task_id: str,
    parent_id: str,
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        _task_or_error(kb, conn, task_id)
        if not kb.unlink_tasks(conn, parent_id, task_id):
            raise ValueError("dependency does not exist")
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def add_attachment_response(
    task_id: str,
    *,
    filename: str,
    data: bytes,
    content_type: Optional[str] = None,
    uploaded_by: str = "amiba",
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        _task_or_error(kb, conn, task_id)
        kb.store_attachment_bytes(
            conn,
            task_id,
            filename,
            data,
            content_type=content_type,
            uploaded_by=uploaded_by,
            board=board,
        )
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}


def get_attachment_response(
    task_id: str,
    attachment_id: int,
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        _task_or_error(kb, conn, task_id)
        attachment = kb.get_attachment(conn, int(attachment_id))
        if attachment is None or attachment.task_id != task_id:
            raise ValueError("attachment not found")
        path = Path(attachment.stored_path).resolve()
        root = kb.task_attachments_dir(task_id, board=board).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("attachment file is unavailable")
        payload = _public_payload(attachment, hidden=("stored_path",))
    return {"ok": True, "board": board, "path": path, "attachment": payload}


def delete_attachment_response(
    task_id: str,
    attachment_id: int,
    *,
    board: Optional[str] = None,
) -> Dict[str, Any]:
    kb = _kanban()
    board = _board_name(kb, board)
    with kb.connect_closing(board=board) as conn:
        _task_or_error(kb, conn, task_id)
        attachment = kb.get_attachment(conn, int(attachment_id))
        if attachment is None or attachment.task_id != task_id:
            raise ValueError("attachment not found")
        kb.delete_attachment(conn, int(attachment_id))
        task = _task_or_error(kb, conn, task_id)
        detail = _detail_payload(kb, conn, task)
    return {"ok": True, "board": board, **detail}
