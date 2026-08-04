from __future__ import annotations

from aiohttp import web

from ....common import json_error, read_json_object
from .profiles_service import (
    create_profile,
    delete_profile,
    list_profiles_response,
    read_profile_soul,
    rename_profile,
    set_active_profile,
    write_profile_description,
    write_profile_soul,
)


def _domain_error(exc: Exception) -> web.Response:
    if isinstance(exc, FileNotFoundError):
        return json_error(404, str(exc))
    if isinstance(exc, (ValueError, FileExistsError)):
        return json_error(400, str(exc))
    return json_error(500, str(exc))


async def handle_profiles_list(_request: web.Request) -> web.Response:
    try:
        return web.json_response(list_profiles_response())
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_create(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    name = body.get("name")
    clone_from = body.get("clone_from")
    description = body.get("description", "")
    if not isinstance(name, str) or not name.strip():
        return json_error(400, "name is required")
    if clone_from is not None and not isinstance(clone_from, str):
        return json_error(400, "clone_from must be a string")
    if not isinstance(description, str):
        return json_error(400, "description must be a string")
    try:
        return web.json_response(
            create_profile(
                name.strip(),
                clone_from=clone_from,
                description=description,
            )
        )
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_rename(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    new_name = body.get("new_name")
    if not isinstance(new_name, str) or not new_name.strip():
        return json_error(400, "new_name is required")
    try:
        return web.json_response(
            rename_profile(request.match_info["name"], new_name.strip())
        )
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_delete(request: web.Request) -> web.Response:
    try:
        return web.json_response(delete_profile(request.match_info["name"]))
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_active(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return json_error(400, "name is required")
    try:
        return web.json_response(set_active_profile(name.strip()))
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_soul_get(request: web.Request) -> web.Response:
    try:
        return web.json_response(read_profile_soul(request.match_info["name"]))
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_soul_put(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    content = body.get("content")
    if not isinstance(content, str):
        return json_error(400, "content must be a string")
    try:
        return web.json_response(
            write_profile_soul(request.match_info["name"], content)
        )
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


async def handle_profile_description_put(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    description = body.get("description")
    if not isinstance(description, str):
        return json_error(400, "description must be a string")
    try:
        return web.json_response(
            write_profile_description(request.match_info["name"], description)
        )
    except Exception as exc:  # noqa: BLE001
        return _domain_error(exc)


def register_profiles_routes(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/profiles", handle_profiles_list),
            web.post("/hermes/profiles", handle_profile_create),
            web.put("/hermes/profiles/active", handle_profile_active),
            web.patch("/hermes/profiles/{name}", handle_profile_rename),
            web.delete("/hermes/profiles/{name}", handle_profile_delete),
            web.get("/hermes/profiles/{name}/soul", handle_profile_soul_get),
            web.put("/hermes/profiles/{name}/soul", handle_profile_soul_put),
            web.put(
                "/hermes/profiles/{name}/description",
                handle_profile_description_put,
            ),
        ]
    )
