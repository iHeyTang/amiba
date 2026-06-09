"""HTTP view over hermes-agent's plugin manager + an enable/disable toggle.

- ``GET /hermes/plugins`` — passes through
  ``hermes_cli.plugins.get_plugin_manager().list_plugins()`` (the exact source
  ``hermes plugins list`` uses), so the UI and CLI never drift.
- ``POST /hermes/plugins/enable`` / ``/disable`` (``?name=`` or ``?key=``) —
  toggle ``config.yaml``'s ``plugins.enabled`` allow-list + ``plugins.disabled``
  deny-list. The loader matches a plugin by *either* its key or name, and the
  existing config keys on name, so we write the name.

Everything is lazy + guarded: outside a Hermes process (e.g. unit tests)
``hermes_cli`` isn't importable, so the list degrades to ``[]`` and toggles
return 503. Most plugins only (un)load on the next agent start — toggles edit
config only (no hot-reload); the response says ``applies_on_restart``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from aiohttp import web

from ....common import json_error


def _list_plugins() -> Optional[List[Dict[str, Any]]]:
    try:
        from hermes_cli.plugins import get_plugin_manager

        return get_plugin_manager().list_plugins()
    except Exception:
        return None


async def handle_list(_request: web.Request) -> web.Response:
    plugins = _list_plugins()
    return web.json_response({"plugins": plugins if plugins is not None else []})


def _ident(request: web.Request) -> str:
    return (request.query.get("name") or request.query.get("key") or "").strip()


def apply_toggle(
    enabled: List[str], disabled: List[str], name: str, enable: bool
) -> Tuple[List[str], List[str]]:
    """Pure membership update for ``plugins.enabled`` / ``plugins.disabled``.

    enable → add to enabled, remove from disabled.
    disable → remove from enabled, add to disabled (the deny-list is needed
    because bundled plugins auto-load regardless of the allow-list).
    Idempotent. Returns new (enabled, disabled) lists; inputs untouched.
    """
    enabled = list(enabled)
    disabled = list(disabled)
    if enable:
        if name not in enabled:
            enabled.append(name)
        disabled = [d for d in disabled if d != name]
    else:
        enabled = [e for e in enabled if e != name]
        if name not in disabled:
            disabled.append(name)
    return enabled, disabled


def _toggle(name: str, enable: bool) -> Tuple[int, Dict[str, Any]]:
    try:
        from hermes_cli.config import load_config, save_config, is_managed
    except Exception:
        return 503, {"error": "hermes_cli.config not available (not in a Hermes process)"}
    try:
        if is_managed():
            return 409, {"error": "managed config — plugin enable/disable is admin-controlled"}
        config = load_config()
        if not isinstance(config, dict):
            config = {}
        plugins_cfg = config.get("plugins")
        if not isinstance(plugins_cfg, dict):
            plugins_cfg = {}

        raw_enabled = plugins_cfg.get("enabled")
        cur_enabled = list(raw_enabled) if isinstance(raw_enabled, list) else []
        raw_disabled = plugins_cfg.get("disabled")
        cur_disabled = list(raw_disabled) if isinstance(raw_disabled, list) else []

        enabled, disabled = apply_toggle(cur_enabled, cur_disabled, name, enable)

        plugins_cfg["enabled"] = enabled
        plugins_cfg["disabled"] = disabled
        config["plugins"] = plugins_cfg
        save_config(config)
        return 200, {
            "ok": True,
            "name": name,
            "enabled": name in enabled and name not in disabled,
            "applies_on_restart": True,
        }
    except Exception as exc:  # noqa: BLE001
        return 500, {"error": f"failed to write config: {exc}"}


async def handle_enable(request: web.Request) -> web.Response:
    name = _ident(request)
    if not name:
        return json_error(400, "missing ?name= (or ?key=)")
    status, body = _toggle(name, True)
    return web.json_response(body) if status == 200 else json_error(status, body.get("error", "error"))


async def handle_disable(request: web.Request) -> web.Response:
    name = _ident(request)
    if not name:
        return json_error(400, "missing ?name= (or ?key=)")
    status, body = _toggle(name, False)
    return web.json_response(body) if status == 200 else json_error(status, body.get("error", "error"))


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.get("/hermes/plugins", handle_list),
            web.post("/hermes/plugins/enable", handle_enable),
            web.post("/hermes/plugins/disable", handle_disable),
        ]
    )
