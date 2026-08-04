from __future__ import annotations

from functools import wraps

from aiohttp import web

from ....adapters.hermes_core import hermes_profile_scope
from ....common import json_error
from .memory_service import MEMORY_TARGETS, read_memory_entries_response


async def handle_memory_list(_request: web.Request) -> web.Response:
    try:
        items = [read_memory_entries_response(t) for t in MEMORY_TARGETS]
    except OSError as exc:
        return json_error(500, str(exc))
    return web.json_response({"ok": True, "targets": items})


async def handle_memory_target(request: web.Request) -> web.Response:
    target = (request.match_info.get("target") or "").strip().lower()
    try:
        return web.json_response(read_memory_entries_response(target))
    except ValueError as exc:
        return json_error(400, str(exc))
    except OSError as exc:
        return json_error(500, str(exc))


def register_memory_routes(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)

        return wrapped

    app.add_routes(
        [
            web.get("/hermes/memories", profiled(handle_memory_list)),
            web.get(
                "/hermes/memories/{target}",
                profiled(handle_memory_target),
            ),
        ]
    )
