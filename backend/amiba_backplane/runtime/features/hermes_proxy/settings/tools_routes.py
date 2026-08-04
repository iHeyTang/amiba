from __future__ import annotations

import asyncio
import subprocess
from functools import wraps

from aiohttp import web

from ....adapters.hermes_core import hermes_profile_scope
from ....common import json_error, read_json_object
from .tools_service import (
    get_computer_use_status,
    get_terminal_backends,
    get_toolset_detail,
    get_toolset_models,
    grant_computer_use_permissions,
    list_installed_mcps,
    list_toolsets,
    run_toolset_post_setup,
    save_terminal_env,
    save_toolset_env,
    select_terminal_backend,
    select_toolset_model,
    select_toolset_provider,
    toggle_toolset,
)


async def handle_tools_list(_request: web.Request) -> web.Response:
    """GET /hermes/tools/toolsets — mirrors upstream GET /api/tools/toolsets.

    Each entry: ``{name, label, description, enabled, available,
    configured, tools}``.
    """
    try:
        return web.json_response(await asyncio.to_thread(list_toolsets))
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        # Upstream helpers can raise on a half-configured hermes install
        # (missing config.yaml, unimportable plugin, …). Surface a 500
        # so the UI can show "tools unavailable" instead of a blank list.
        return json_error(500, str(exc))


async def handle_tools_detail(request: web.Request) -> web.Response:
    """GET one capability, including provider readiness and advanced tools."""
    name = request.match_info.get("name", "")
    if not name:
        return json_error(400, "name is required")
    try:
        payload = await asyncio.to_thread(get_toolset_detail, name)
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    if not payload.get("ok"):
        return web.json_response(payload, status=404)
    return web.json_response(payload)


async def handle_tools_provider(request: web.Request) -> web.Response:
    """PUT a provider choice without accepting arbitrary config keys."""

    name = request.match_info.get("name", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    provider = body.get("provider")
    capability = body.get("capability")
    if not isinstance(provider, str) or not provider.strip():
        return json_error(400, "provider must be a non-empty string")
    if capability is not None and not isinstance(capability, str):
        return json_error(400, "capability must be a string")
    try:
        payload = select_toolset_provider(
            name,
            provider.strip(),
            capability=capability.strip() if isinstance(capability, str) else None,
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_tools_env(request: web.Request) -> web.Response:
    """PUT allow-listed provider keys into Hermes' canonical ``.env``."""

    name = request.match_info.get("name", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    values = body.get("env")
    if not isinstance(values, dict):
        return json_error(400, "env must be an object")
    try:
        payload = save_toolset_env(name, values)
    except ValueError as exc:
        return json_error(400, str(exc))
    except OSError as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_tools_models(request: web.Request) -> web.Response:
    """GET the selectable image/video model catalog for a provider."""

    name = request.match_info.get("name", "")
    provider = request.query.get("provider") or None
    try:
        payload = get_toolset_models(name, provider)
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_tools_model(request: web.Request) -> web.Response:
    """PUT a validated image/video generation model."""

    name = request.match_info.get("name", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    model = body.get("model")
    provider = body.get("provider")
    if not isinstance(model, str) or not model.strip():
        return json_error(400, "model must be a non-empty string")
    if provider is not None and not isinstance(provider, str):
        return json_error(400, "provider must be a string")
    try:
        payload = select_toolset_model(
            name,
            model.strip(),
            provider_name=provider.strip() if isinstance(provider, str) else None,
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_tools_post_setup(request: web.Request) -> web.Response:
    """POST an allow-listed setup action without blocking the event loop."""

    name = request.match_info.get("name", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    key = body.get("key")
    if not isinstance(key, str) or not key.strip():
        return json_error(400, "key must be a non-empty string")
    try:
        payload = await asyncio.to_thread(
            run_toolset_post_setup,
            name,
            key.strip(),
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
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


async def handle_terminal_backends(_request: web.Request) -> web.Response:
    """GET terminal choices and their current readiness."""

    try:
        payload = await asyncio.to_thread(get_terminal_backends)
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_terminal_backend(request: web.Request) -> web.Response:
    """PUT a validated terminal execution backend."""

    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    backend = body.get("backend")
    if not isinstance(backend, str) or not backend.strip():
        return json_error(400, "backend must be a non-empty string")
    try:
        payload = select_terminal_backend(backend)
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_terminal_env(request: web.Request) -> web.Response:
    """PUT allow-listed terminal connection settings."""

    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    values = body.get("env")
    if not isinstance(values, dict):
        return json_error(400, "env must be an object")
    try:
        payload = save_terminal_env(values)
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_computer_use_status(_request: web.Request) -> web.Response:
    """GET cua-driver health and OS permission readiness."""

    try:
        payload = await asyncio.to_thread(get_computer_use_status)
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_computer_use_grant(_request: web.Request) -> web.Response:
    """POST the fixed Hermes permission-grant flow."""

    try:
        payload = grant_computer_use_permissions()
    except ValueError as exc:
        return json_error(400, str(exc))
    except (OSError, subprocess.SubprocessError) as exc:
        return json_error(500, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
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
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)

        return wrapped

    app.add_routes(
        [
            web.get("/hermes/tools/toolsets", profiled(handle_tools_list)),
            web.get(
                "/hermes/tools/toolsets/{name}",
                profiled(handle_tools_detail),
            ),
            web.put(
                "/hermes/tools/toolsets/{name}",
                profiled(handle_tools_toggle),
            ),
            web.put(
                "/hermes/tools/toolsets/{name}/provider",
                profiled(handle_tools_provider),
            ),
            web.put(
                "/hermes/tools/toolsets/{name}/env",
                profiled(handle_tools_env),
            ),
            web.get(
                "/hermes/tools/toolsets/{name}/models",
                profiled(handle_tools_models),
            ),
            web.put(
                "/hermes/tools/toolsets/{name}/model",
                profiled(handle_tools_model),
            ),
            web.post(
                "/hermes/tools/toolsets/{name}/post-setup",
                profiled(handle_tools_post_setup),
            ),
            web.get(
                "/hermes/tools/terminal/backends",
                profiled(handle_terminal_backends),
            ),
            web.put(
                "/hermes/tools/terminal/backend",
                profiled(handle_terminal_backend),
            ),
            web.put(
                "/hermes/tools/terminal/env",
                profiled(handle_terminal_env),
            ),
            web.get(
                "/hermes/tools/computer-use/status",
                profiled(handle_computer_use_status),
            ),
            web.post(
                "/hermes/tools/computer-use/permissions/grant",
                profiled(handle_computer_use_grant),
            ),
            web.get(
                "/hermes/tools/installed-mcps",
                profiled(handle_installed_mcps),
            ),
        ]
    )
