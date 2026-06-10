"""HTTP adapter over the backplane's mention-source registry.

The backplane is the only thing that speaks HTTP. Mention sources are
HTTP-agnostic domain logic (see :mod:`hermes_x_backplane.runtime.mention_sources`)
that let the desktop composer @-mention an external system's resources. This
module exposes the front-end-relevant slices as a web API:

- ``GET    /mention-sources/<name>/search`` — call the source's ``search``
  capability in-process and return its items.
- ``GET    /hermes/mention-resources``      — the flattened mention-resource
  registry (for the composer's ``@`` providers).
- ``GET    /hermes/mention-sources``        — lifecycle snapshot (admin).
- ``POST   /hermes/mention-sources``        — install from git/path (admin).
- ``POST   /hermes/mention-sources/update`` — ``git pull`` + re-import.
- ``POST   /hermes/mention-sources/reload`` — re-import (no git).
- ``DELETE /hermes/mention-sources/{name}`` — unregister + delete files.

Lifecycle is plain git under the hood (see :mod:`...mention_sources.manager`);
the desktop UI drives these routes. ``/integrations/<name>/search`` stays as a
legacy alias. Every route degrades gracefully if the framework is somehow
unavailable, so the backplane stays up regardless.
"""

from __future__ import annotations

from typing import Any, Optional, Tuple

from aiohttp import web

from ....common import json_error


def _framework() -> Tuple[Optional[Any], Optional[Any]]:
    """Return ``(loader, manager)`` from the mention-sources framework, or
    (None, None) if it somehow can't be imported."""
    try:
        from ....mention_sources import loader, manager  # type: ignore

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

    loader, _ = _framework()
    entry = loader.get(name) if loader is not None else None
    if entry is None or entry.search is None:
        # No such source / no search capability — degrade to empty so the
        # composer just shows no candidates (never a transport error).
        return web.json_response({"ok": True, "items": []})
    try:
        payload = await entry.search(rtype, query, limit)
    except Exception:
        return web.json_response({"ok": True, "items": [], "error": "search failed"})
    return web.json_response(payload if isinstance(payload, dict) else {"ok": True, "items": []})


async def handle_mention_resources(_request: web.Request) -> web.Response:
    loader, _ = _framework()
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
    _, manager = _framework()
    if manager is None:
        return web.json_response({"sources": [], "failed": [], "user_dir": ""})
    return web.json_response(manager.list_sources())


async def handle_install(request: web.Request) -> web.Response:
    """Install a source from git/path, then register it live.

    Body (JSON): ``{from_git, ref, from_path, name, overwrite}``. The desktop UI
    POSTs here. ``name`` may be omitted for dir/git sources (read from the
    manifest). Under the hood this is ``git clone`` (see the manager).
    """
    loader, manager = _framework()
    if manager is None:
        return json_error(503, "mention-sources framework unavailable")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        result = manager.install(
            name=body.get("name"),
            from_git=body.get("from_git"),
            git_ref=body.get("ref"),
            from_path=body.get("from_path"),
            overwrite=bool(body.get("overwrite", False)),
        )
        # Register the freshly-installed source into the live registry so search
        # / mention-resources see it without a backplane restart.
        if loader is not None and result.get("name"):
            try:
                loader.load_one(result["name"])
            except Exception as exc:  # noqa: BLE001
                result["load_warning"] = str(exc)
        return web.json_response(result)
    except manager.SourceError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


async def handle_update(request: web.Request) -> web.Response:
    _, manager = _framework()
    if manager is None:
        return json_error(503, "mention-sources framework unavailable")
    name = request.query.get("name", "")
    try:
        return web.json_response(manager.update(name))
    except manager.SourceError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


async def handle_reload(request: web.Request) -> web.Response:
    _, manager = _framework()
    if manager is None:
        return json_error(503, "mention-sources framework unavailable")
    name = request.query.get("name", "")
    try:
        return web.json_response(manager.reload(name))
    except manager.SourceError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


async def handle_remove(request: web.Request) -> web.Response:
    _, manager = _framework()
    if manager is None:
        return json_error(503, "mention-sources framework unavailable")
    name = request.match_info.get("name", "")
    try:
        return web.json_response(manager.remove(name))
    except manager.SourceError as exc:
        return json_error(_admin_status(manager, exc), str(exc))


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/mention-sources/{name}/search", handle_search),
            web.get("/integrations/{name}/search", handle_search),  # legacy alias
            web.get("/hermes/mention-resources", handle_mention_resources),
            web.get("/hermes/mention-sources", handle_list),
            web.post("/hermes/mention-sources", handle_install),
            web.post("/hermes/mention-sources/update", handle_update),
            web.post("/hermes/mention-sources/reload", handle_reload),
            web.delete("/hermes/mention-sources/{name}", handle_remove),
        ]
    )
