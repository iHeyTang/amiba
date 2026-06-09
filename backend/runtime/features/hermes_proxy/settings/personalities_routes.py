from __future__ import annotations

from aiohttp import web

from .personalities_service import list_personalities_response
from ....common import json_error


async def handle_personalities_list(_request: web.Request) -> web.Response:
    """GET /hermes/personalities — agent personalities (builtin + custom)."""
    try:
        payload = list_personalities_response()
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_personalities_routes(app: web.Application) -> None:
    app.add_routes([web.get("/hermes/personalities", handle_personalities_list)])
