from __future__ import annotations

from aiohttp import web

from ....adapters.hermes_core import hermes_profile_scope
from .personalities_service import (
    delete_personality_response,
    list_personalities_response,
    save_personality_response,
    set_selected_personality_response,
)
from ....common import json_error


async def handle_personalities_list(request: web.Request) -> web.Response:
    """GET /hermes/personalities — active profile's effective CLI list."""
    try:
        with hermes_profile_scope(request.query.get("profile")):
            payload = list_personalities_response()
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_personality_save(request: web.Request) -> web.Response:
    """PUT /hermes/personalities/{key} — create or override one mode."""
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("JSON object required")
        with hermes_profile_scope(request.query.get("profile")):
            payload = save_personality_response(
                request.match_info["key"],
                system_prompt=str(body.get("system_prompt") or ""),
                name=str(body.get("name") or request.match_info["key"]),
                description=str(body.get("description") or ""),
                tone=str(body.get("tone") or ""),
                style=str(body.get("style") or ""),
                previous_key=str(body.get("previous_key") or ""),
            )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_personality_selection(request: web.Request) -> web.Response:
    """PUT /hermes/personalities/active — choose this profile's default mode."""
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("JSON object required")
        with hermes_profile_scope(request.query.get("profile")):
            payload = set_selected_personality_response(str(body.get("key") or ""))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_personality_delete(request: web.Request) -> web.Response:
    """DELETE /hermes/personalities/{key} — delete custom or reset builtin."""
    try:
        with hermes_profile_scope(request.query.get("profile")):
            payload = delete_personality_response(request.match_info["key"])
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_personalities_routes(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/personalities", handle_personalities_list),
            web.put("/hermes/personalities/active", handle_personality_selection),
            web.put("/hermes/personalities/{key}", handle_personality_save),
            web.delete("/hermes/personalities/{key}", handle_personality_delete),
        ]
    )
