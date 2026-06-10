from __future__ import annotations

from aiohttp import web

from .tools_service import (
    get_toolset_detail,
    list_installed_mcps,
    list_toolsets,
    toggle_toolset,
)
from ....common import json_error, read_json_object


async def handle_tools_list(_request: web.Request) -> web.Response:
    """GET /hermes/tools/toolsets — mirrors upstream GET /api/tools/toolsets.

    Each entry: ``{name, label, description, enabled, available,
    configured, tools}``.
    """
    try:
        return web.json_response(list_toolsets())
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        # Upstream helpers can raise on a half-configured hermes install
        # (missing config.yaml, unimportable plugin, …). Surface a 500
        # so the UI can show "tools unavailable" instead of a blank list.
        return json_error(500, str(exc))


async def handle_tools_detail(request: web.Request) -> web.Response:
    """GET /hermes/tools/toolsets/{name} — extended detail for one toolset.

    Returns the same fields as the list row plus per-tool ``items``
    (each ``{name, description, emoji}``) and a ``providers`` matrix
    with per-key ``is_set`` flags. 404 for unknown toolset keys.
    """
    name = request.match_info.get("name", "")
    if not name:
        return json_error(400, "name is required")
    try:
        payload = get_toolset_detail(name)
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    if not payload.get("ok"):
        return web.json_response(payload, status=404)
    return web.json_response(payload)


async def handle_tools_toggle(request: web.Request) -> web.Response:
    """PUT /hermes/tools/toolsets/{name} — body ``{enabled: bool}``.

    Mirrors upstream PUT /api/tools/toolsets/{name}. Returns
    ``{ok, name, enabled}``; 400 for unknown toolset or bad body.
    """
    name = request.match_info.get("name", "")
    if not name:
        return json_error(400, "name is required")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        return json_error(400, "enabled must be a boolean")
    try:
        payload = toggle_toolset(name, enabled)
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    if not payload.get("ok"):
        return web.json_response(payload, status=400)
    return web.json_response(payload)


async def handle_installed_mcps(_request: web.Request) -> web.Response:
    """GET /hermes/tools/installed-mcps — MCP servers from config.yaml.

    Returns ``{ok, items}`` where each item carries ``{slug, label,
    description, source, installed: true, enabled, transport_kind}``.
    """
    try:
        items = list_installed_mcps()
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response({"ok": True, "items": items})


def register_tools_routes(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/tools/toolsets", handle_tools_list),
            web.get("/hermes/tools/toolsets/{name}", handle_tools_detail),
            web.put("/hermes/tools/toolsets/{name}", handle_tools_toggle),
            web.get("/hermes/tools/installed-mcps", handle_installed_mcps),
        ]
    )
