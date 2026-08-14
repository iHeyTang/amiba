from __future__ import annotations

import asyncio
import subprocess
from functools import wraps

from aiohttp import web

from ....adapters.hermes_core import hermes_profile_scope
from ....common import json_error, read_json_object
from .tools_service import (
    get_computer_use_status,
    get_context_engines,
    get_installed_mcp_connection,
    get_terminal_backends,
    get_toolset_detail,
    get_toolset_models,
    grant_computer_use_permissions,
    list_a2a_peers,
    list_installed_mcps,
    list_toolsets,
    remove_a2a_peer,
    remove_mcp_server,
    run_toolset_post_setup,
    save_a2a_peer,
    save_mcp_server,
    save_terminal_env,
    save_toolset_env,
    select_context_engine,
    select_terminal_backend,
    select_toolset_model,
    select_toolset_provider,
    toggle_toolset,
    test_mcp_server,
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


async def handle_context_engines(_request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(get_context_engines))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_context_engine(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    engine = body.get("engine")
    if not isinstance(engine, str) or not engine.strip():
        return json_error(400, "engine must be a non-empty string")
    try:
        return web.json_response(select_context_engine(engine.strip()))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_a2a_peers(_request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(list_a2a_peers))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_a2a_peer_put(request: web.Request) -> web.Response:
    name = request.match_info.get("name", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    url = body.get("url")
    capabilities = body.get("capabilities", [])
    token = body.get("token")
    clear_token = body.get("clear_token", False)
    if not isinstance(url, str):
        return json_error(400, "url must be a string")
    if not isinstance(capabilities, list) or not all(
        isinstance(item, str) for item in capabilities
    ):
        return json_error(400, "capabilities must be a string array")
    if token is not None and not isinstance(token, str):
        return json_error(400, "token must be a string")
    if not isinstance(clear_token, bool):
        return json_error(400, "clear_token must be a boolean")
    try:
        payload = save_a2a_peer(
            name,
            url=url,
            timeout=body.get("timeout", 120),
            capabilities=capabilities,
            token=token,
            clear_token=clear_token,
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_a2a_peer_delete(request: web.Request) -> web.Response:
    try:
        payload = remove_a2a_peer(request.match_info.get("name", ""))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
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


async def handle_installed_mcp_connection(request: web.Request) -> web.Response:
    """Resolve a Provider ID for the trusted desktop MCP host."""

    slug = request.match_info.get("slug", "")
    try:
        payload = get_installed_mcp_connection(slug)
    except ValueError as exc:
        return json_error(400, str(exc))
    except KeyError:
        return json_error(404, "MCP provider not found or disabled")
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response({"ok": True, "connection": payload})


async def handle_save_mcp(request: web.Request) -> web.Response:
    slug = request.match_info.get("slug", "")
    try:
        body = await read_json_object(request)
        payload = await asyncio.to_thread(save_mcp_server, slug, body)
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_remove_mcp(request: web.Request) -> web.Response:
    slug = request.match_info.get("slug", "")
    try:
        payload = await asyncio.to_thread(remove_mcp_server, slug)
    except ValueError as exc:
        return json_error(400, str(exc))
    except KeyError:
        return json_error(404, "MCP server not found")
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_test_mcp(request: web.Request) -> web.Response:
    slug = request.match_info.get("slug", "")
    try:
        payload = await asyncio.to_thread(test_mcp_server, slug)
    except ValueError as exc:
        return json_error(400, str(exc))
    except KeyError:
        return json_error(404, "MCP server not found")
    except Exception as exc:  # noqa: BLE001
        return json_error(400, str(exc))
    return web.json_response(payload)


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
            web.get(
                "/hermes/tools/context-engines",
                profiled(handle_context_engines),
            ),
            web.put(
                "/hermes/tools/context-engine",
                profiled(handle_context_engine),
            ),
            web.get(
                "/hermes/tools/a2a/peers",
                profiled(handle_a2a_peers),
            ),
            web.put(
                "/hermes/tools/a2a/peers/{name}",
                profiled(handle_a2a_peer_put),
            ),
            web.delete(
                "/hermes/tools/a2a/peers/{name}",
                profiled(handle_a2a_peer_delete),
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
            web.get(
                "/hermes/tools/installed-mcps/{slug}/connection",
                profiled(handle_installed_mcp_connection),
            ),
            web.put(
                "/hermes/tools/installed-mcps/{slug}",
                profiled(handle_save_mcp),
            ),
            web.delete(
                "/hermes/tools/installed-mcps/{slug}",
                profiled(handle_remove_mcp),
            ),
            web.post(
                "/hermes/tools/installed-mcps/{slug}/test",
                profiled(handle_test_mcp),
            ),
        ]
    )
