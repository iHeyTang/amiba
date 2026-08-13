"""Read-only HTTP adapter for legacy composer mention sources.

The backplane is the only thing that speaks HTTP. Mention sources are
HTTP-agnostic domain logic (see :mod:`amiba_backplane.runtime.mention_sources`)
that let the desktop composer @-mention an external system's resources. This
module exposes the front-end-relevant slices as a web API:

- ``GET    /mention-sources/<name>/search`` — call the source's ``search``
  capability in-process and return its items.
- ``GET    /hermes/mention-resources``      — the flattened mention-resource
  registry (for the composer's ``@`` providers).
New @-mention capabilities belong to Applets and are declared in their
manifest. These routes intentionally retain search/read only so a user's
already-installed legacy sources continue to work during migration. There is
no standalone mention-source lifecycle surface anymore.
"""

from __future__ import annotations

from typing import Any, Optional

from aiohttp import web

def _loader() -> Optional[Any]:
    """Return the legacy compatibility loader, if available."""
    try:
        from ....mention_sources import loader  # type: ignore

        return loader
    except Exception:
        return None


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

    loader = _loader()
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
    loader = _loader()
    resources = loader.mention_resources() if loader is not None else []
    return web.json_response({"resources": resources})


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/mention-sources/{name}/search", handle_search),
            web.get("/integrations/{name}/search", handle_search),  # legacy alias
            web.get("/hermes/mention-resources", handle_mention_resources),
        ]
    )
