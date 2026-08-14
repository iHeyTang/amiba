from __future__ import annotations

from urllib.parse import quote

from aiohttp import web

from ....common import json_error, read_json_object
from .service import (
    add_attachment_response,
    add_comment_response,
    add_dependency_response,
    create_task_response,
    delete_attachment_response,
    delete_task_response,
    get_attachment_response,
    get_task_response,
    list_boards_response,
    list_tasks_response,
    remove_dependency_response,
    task_action_response,
    update_task_response,
)


def _board(request: web.Request) -> str | None:
    return (request.query.get("board") or "").strip() or None


async def handle_boards(_request: web.Request) -> web.Response:
    try:
        return web.json_response(list_boards_response())
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_tasks(request: web.Request) -> web.Response:
    board = _board(request)
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
    board = _board(request)
    try:
        return web.json_response(create_task_response(body, board=board))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_detail(request: web.Request) -> web.Response:
    try:
        return web.json_response(
            get_task_response(request.match_info["task_id"], board=_board(request))
        )
    except ValueError as exc:
        return json_error(404, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_update(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        return web.json_response(
            update_task_response(
                request.match_info["task_id"], body, board=_board(request)
            )
        )
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_delete(request: web.Request) -> web.Response:
    try:
        return web.json_response(
            delete_task_response(request.match_info["task_id"], board=_board(request))
        )
    except ValueError as exc:
        return json_error(404, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_action(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        return web.json_response(
            task_action_response(
                request.match_info["task_id"], body, board=_board(request)
            )
        )
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_comment(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        return web.json_response(
            add_comment_response(
                request.match_info["task_id"], body, board=_board(request)
            )
        )
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_dependency_add(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        return web.json_response(
            add_dependency_response(
                request.match_info["task_id"], body, board=_board(request)
            )
        )
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_dependency_delete(request: web.Request) -> web.Response:
    try:
        return web.json_response(
            remove_dependency_response(
                request.match_info["task_id"],
                request.match_info["parent_id"],
                board=_board(request),
            )
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_attachment_add(request: web.Request) -> web.Response:
    try:
        reader = await request.multipart()
        part = await reader.next()
        while part is not None and not part.filename:
            part = await reader.next()
        if part is None or not part.filename:
            return json_error(400, "file is required")
        data = await part.read(decode=False)
        return web.json_response(
            add_attachment_response(
                request.match_info["task_id"],
                filename=part.filename,
                data=data,
                content_type=part.headers.get("Content-Type"),
                uploaded_by=(request.query.get("uploaded_by") or "amiba").strip(),
                board=_board(request),
            )
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_attachment_get(request: web.Request) -> web.StreamResponse:
    try:
        result = get_attachment_response(
            request.match_info["task_id"],
            int(request.match_info["attachment_id"]),
            board=_board(request),
        )
        attachment = result["attachment"]
        response = web.FileResponse(path=result["path"])
        response.headers["Content-Disposition"] = (
            "attachment; filename*=UTF-8''" + quote(attachment["filename"])
        )
        return response
    except (TypeError, ValueError) as exc:
        return json_error(404, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_task_attachment_delete(request: web.Request) -> web.Response:
    try:
        return web.json_response(
            delete_attachment_response(
                request.match_info["task_id"],
                int(request.match_info["attachment_id"]),
                board=_board(request),
            )
        )
    except (TypeError, ValueError) as exc:
        return json_error(404, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/kanban/boards", handle_boards),
            web.get("/hermes/kanban/tasks", handle_tasks),
            web.post("/hermes/kanban/tasks", handle_task_create),
            web.get("/hermes/kanban/tasks/{task_id}", handle_task_detail),
            web.patch("/hermes/kanban/tasks/{task_id}", handle_task_update),
            web.delete("/hermes/kanban/tasks/{task_id}", handle_task_delete),
            web.post("/hermes/kanban/tasks/{task_id}/actions", handle_task_action),
            web.post("/hermes/kanban/tasks/{task_id}/comments", handle_task_comment),
            web.post(
                "/hermes/kanban/tasks/{task_id}/dependencies",
                handle_task_dependency_add,
            ),
            web.delete(
                "/hermes/kanban/tasks/{task_id}/dependencies/{parent_id}",
                handle_task_dependency_delete,
            ),
            web.post(
                "/hermes/kanban/tasks/{task_id}/attachments",
                handle_task_attachment_add,
            ),
            web.get(
                "/hermes/kanban/tasks/{task_id}/attachments/{attachment_id}",
                handle_task_attachment_get,
            ),
            web.delete(
                "/hermes/kanban/tasks/{task_id}/attachments/{attachment_id}",
                handle_task_attachment_delete,
            ),
        ]
    )
