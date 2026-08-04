from __future__ import annotations

from aiohttp import web

from ....common import json_error, read_json_object
from .service import (
    create_task_response,
    list_boards_response,
    list_tasks_response,
)


async def handle_boards(_request: web.Request) -> web.Response:
    try:
        return web.json_response(list_boards_response())
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_tasks(request: web.Request) -> web.Response:
    board = (request.query.get("board") or "").strip() or None
    session_id = (request.query.get("session_id") or "").strip() or None
    include_archived = request.query.get("include_archived", "0").lower() in {
        "1",
        "true",
        "yes",
    }
    try:
        return web.json_response(
            list_tasks_response(
                board=board,
                session_id=session_id,
                include_archived=include_archived,
            )
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_create(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    board = (request.query.get("board") or "").strip() or None
    try:
        return web.json_response(create_task_response(body, board=board))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/kanban/boards", handle_boards),
            web.get("/hermes/kanban/tasks", handle_tasks),
            web.post("/hermes/kanban/tasks", handle_task_create),
        ]
    )
