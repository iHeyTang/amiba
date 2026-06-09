"""HTTP adapter over the ``hermes-x-plugin-integrations`` registry.

The backplane is the only thing that speaks HTTP. Integrations themselves are
HTTP-agnostic domain logic loaded by the integrations plugin; this module
treats "Hermes + installed integrations" as upstream and exposes the
front-end-relevant slices as a web API for the composer:

- ``GET    /integrations/<name>/search`` — call the integration's ``search``
  capability in-process and return its items.
- ``GET    /hermes/mention-resources``   — the flattened mention-resource
  registry (for the composer's ``@`` providers).
- ``GET    /hermes/integrations``        — lifecycle snapshot (admin).
- ``POST   /hermes/integrations/reload`` — re-import + swap one integration.
- ``DELETE /hermes/integrations/{name}`` — unregister + delete files.

If the integrations plugin isn't installed, every route degrades gracefully
(empty registry / 503 on lifecycle) — the backplane stays up regardless.
"""

from __future__ import annotations

from typing import Any, Optional, Tuple

from aiohttp import web

from ....common import json_error


def _integrations() -> Tuple[Optional[Any], Optional[Any]]:
    """Return ``(loader, manager)`` from the integrations plugin, or (None, None)."""
    try:
        from hermes_plugin_integrations import loader, manager  # type: ignore

        return loader, manager
    except Exception:
        return None, None


def _parse_int(value: Optional[str], default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


async def handle_search(request: web.Request) -> web.Response:
    name = request.match_info.get("name", "")
    rtype = request.query.get("type", "")
    query = request.query.get("q", "")
    limit = _parse_int(request.query.get("limit"), 8)

    loader, _ = _integrations()
    entry = loader.get(name) if loader is not None else None
    if entry is None or entry.search is None:
        # No such integration / no search capability — degrade to empty so the
        # composer just shows no candidates (never a transport error).
        return web.json_response({"ok": True, "items": []})
    try:
        payload = await entry.search(rtype, query, limit)
    except Exception:
        return web.json_response({"ok": True, "items": [], "error": "search failed"})
    return web.json_response(payload if isinstance(payload, dict) else {"ok": True, "items": []})


async def handle_mention_resources(_request: web.Request) -> web.Response:
    loader, _ = _integrations()
    resources = loader.mention_resources() if loader is not None else []
    return web.json_response({"resources": resources})


def _admin_status(manager: Any, exc: Exception) -> int:
    if isinstance(exc, manager.NameInvalid):
        return 400
    if isinstance(exc, manager.NameTaken):
        return 409
    if isinstance(exc, manager.NotFound):
        return 404
    return 400


async def handle_list(_request: web.Request) -> web.Response:
    _, manager = _integrations()
    if manager is None:
        return web.json_response({"integrations": [], "failed": [], "user_dir": ""})
    return web.json_response(manager.list_integrations())


async def handle_reload(request: web.Request) -> web.Response:
    _, manager = _integrations()
    if manager is None:
        return json_error(503, "integrations plugin not installed")
    name = request.query.get("name", "")
    try:
        return web.json_response(manager.reload(name))
    except manager.IntegrationError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


async def handle_remove(request: web.Request) -> web.Response:
    _, manager = _integrations()
    if manager is None:
        return json_error(503, "integrations plugin not installed")
    name = request.match_info.get("name", "")
    try:
        return web.json_response(manager.remove(name))
    except manager.IntegrationError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/integrations/{name}/search", handle_search),
            web.get("/hermes/mention-resources", handle_mention_resources),
            web.get("/hermes/integrations", handle_list),
            web.post("/hermes/integrations/reload", handle_reload),
            web.delete("/hermes/integrations/{name}", handle_remove),
        ]
    )
