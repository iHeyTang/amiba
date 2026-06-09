from __future__ import annotations

from aiohttp import web

from .commands_service import list_commands_response
from ....common import json_error


async def handle_commands_list(_request: web.Request) -> web.Response:
    """GET /hermes/commands — slash commands available to web/desktop clients.

    Serialized live from hermes_cli.commands.COMMAND_REGISTRY, so it never
    drifts from what the CLI knows.
    """
    try:
        payload = list_commands_response()
    except Exception as exc:  # registry import / config errors -> 500
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_commands_routes(app: web.Application) -> None:
    app.add_routes([web.get("/hermes/commands", handle_commands_list)])
