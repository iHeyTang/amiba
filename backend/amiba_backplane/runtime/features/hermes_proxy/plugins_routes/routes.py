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

import asyncio
import shutil
import subprocess
import sys
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from aiohttp import web

from ....adapters.hermes_core import hermes_profile_scope
from ....common import json_error, read_json_object


def _list_plugins() -> Optional[List[Dict[str, Any]]]:
    try:
        from hermes_cli.plugins import get_plugin_manager

        mgr = get_plugin_manager()
        # `get_plugin_manager()` is a module-level singleton whose plugin set is
        # cached after the first discovery. This backplane is a LONG-LIVED
        # process, so without a re-scan the list would be frozen at whatever was
        # on disk when the process started — drifting from reality as the user
        # installs/removes plugins. Re-discover on every read (force=True clears
        # + rebuilds, so it's idempotent) so this view stays consistent with
        # `hermes plugins list`, which re-discovers fresh on each invocation.
        mgr.discover_and_load(force=True)
        return _enrich_with_dist(mgr.list_plugins())
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


# Sources whose lifecycle this endpoint does NOT own. Bundled ships with
# hermes-agent; project plugins live in the user's repo. Both are refused
# (the user can disable bundled instead). user/entrypoint return None = OK.
_UNINSTALL_REFUSALS: Dict[str, str] = {
    "bundled": "bundled plugin ships with hermes-agent and can't be uninstalled — disable it instead",
    "project": "project plugin is owned by your repo's ./.hermes/plugins — remove it there",
}


def uninstall_refusal(source: str) -> Optional[str]:
    """Refusal message for sources we don't own, else None."""
    return _UNINSTALL_REFUSALS.get(source)


def drop_from_lists(
    enabled: List[str], disabled: List[str], name: str
) -> Tuple[List[str], List[str]]:
    """Remove ``name`` from both lists. Pure; inputs untouched."""
    return [e for e in enabled if e != name], [d for d in disabled if d != name]


def pip_uninstall_cmd(dist: str) -> List[str]:
    """Argv to uninstall ``dist`` from the interpreter running this backplane."""
    return [sys.executable, "-m", "pip", "uninstall", "-y", dist]


def _remove_plugin_dir(target: Path) -> bool:
    """Remove a user plugin at ``target``. Symlink-aware: unlinks a symlink
    (so the real source dir is preserved — upstream ``hermes plugins remove``
    rmtree's and would raise on a symlink), rmtree's a real dir. Returns
    whether anything was removed."""
    if target.is_symlink():
        target.unlink()
        return True
    if target.is_dir():
        shutil.rmtree(target)
        return True
    return False


def _resolve_entrypoint_dist(name: str) -> Optional[str]:
    """Map an entrypoint plugin name to the distribution that provides it
    (group ``hermes_agent.plugins``). Works even when the module fails to
    import — it reads package metadata, not the module."""
    try:
        import importlib.metadata as md
    except Exception:
        return None
    try:
        for dist in md.distributions():
            try:
                eps = dist.entry_points
            except Exception:
                continue
            for ep in eps:
                if getattr(ep, "group", "") == "hermes_agent.plugins" and ep.name == name:
                    return dist.metadata["Name"]
    except Exception:
        return None
    return None


def _enrich_with_dist(rows, resolver=_resolve_entrypoint_dist):
    """Attach a ``dist`` field to each entrypoint row (display only). Other
    sources are left untouched. ``resolver`` is injectable for testing."""
    for row in rows:
        if row.get("source") == "entrypoint":
            row["dist"] = resolver(row.get("name") or "")
    return rows


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


def _pip_uninstall(dist: str) -> Tuple[bool, str]:
    try:
        proc = subprocess.run(
            pip_uninstall_cmd(dist), capture_output=True, text=True, timeout=120
        )
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    if proc.returncode != 0:
        return False, (proc.stderr or proc.stdout or "pip uninstall failed").strip()
    return True, ""


def _find_plugin(name: str) -> Optional[Dict[str, Any]]:
    plugins = _list_plugins()
    if not plugins:
        return None
    for p in plugins:
        if p.get("name") == name or p.get("key") == name:
            return p
    return None


def _clean_config(name: str) -> None:
    """Drop ``name`` from plugins.enabled / plugins.disabled so an uninstalled
    plugin leaves no orphaned config entry. Best-effort; never raises."""
    try:
        from hermes_cli.config import load_config, save_config
    except Exception:
        return
    try:
        config = load_config()
        if not isinstance(config, dict):
            return
        plugins_cfg = config.get("plugins")
        if not isinstance(plugins_cfg, dict):
            return
        raw_en = plugins_cfg.get("enabled")
        raw_dis = plugins_cfg.get("disabled")
        en = list(raw_en) if isinstance(raw_en, list) else []
        dis = list(raw_dis) if isinstance(raw_dis, list) else []
        new_en, new_dis = drop_from_lists(en, dis, name)
        plugins_cfg["enabled"] = new_en
        plugins_cfg["disabled"] = new_dis
        config["plugins"] = plugins_cfg
        save_config(config)
    except Exception:
        return


def _uninstall(name: str) -> Tuple[int, Dict[str, Any]]:
    try:
        from hermes_cli.plugins_cmd import _plugins_dir, _sanitize_plugin_name
    except Exception:
        return 503, {"error": "hermes_cli not available (not in a Hermes process)"}

    plugin = _find_plugin(name)
    if plugin is None:
        return 404, {"error": f"plugin '{name}' not found"}

    source = str(plugin.get("source") or "")
    refusal = uninstall_refusal(source)
    if refusal is not None:
        return 409, {"error": refusal}

    ident = plugin.get("key") or plugin.get("name") or name
    try:
        if source == "entrypoint":
            dist = _resolve_entrypoint_dist(plugin.get("name") or name)
            if not dist:
                return 500, {"error": f"could not resolve distribution for '{name}'"}
            ok, err = _pip_uninstall(dist)
            if not ok:
                return 500, {"error": f"pip uninstall failed: {err}"}
        elif source == "user":
            plugins_dir = _plugins_dir()
            target = _sanitize_plugin_name(ident, plugins_dir, allow_subdir=True)
            if not _remove_plugin_dir(target):
                return 404, {"error": f"'{name}' not found in {plugins_dir}"}
        else:
            return 409, {"error": f"unknown source '{source}' — refusing to uninstall"}

        _clean_config(plugin.get("name") or name)
        return 200, {
            "ok": True,
            "name": name,
            "source": source,
            "removed": True,
            "applies_on_restart": True,
        }
    except Exception as exc:  # noqa: BLE001
        return 500, {"error": f"uninstall failed: {exc}"}


async def handle_uninstall(request: web.Request) -> web.Response:
    name = _ident(request)
    if not name:
        return json_error(400, "missing ?name= (or ?key=)")
    status, body = _uninstall(name)
    return web.json_response(body) if status == 200 else json_error(status, body.get("error", "error"))


def _dashboard_plugin_action(action: str, **kwargs: Any) -> Dict[str, Any]:
    """Run Hermes' non-interactive dashboard helpers without blocking aiohttp."""
    try:
        from hermes_cli.plugins_cmd import (
            dashboard_install_plugin,
            dashboard_update_user_plugin,
        )
    except Exception as exc:
        return {"ok": False, "error": f"hermes_cli plugins unavailable: {exc}"}
    try:
        if action == "install":
            return dict(dashboard_install_plugin(**kwargs))
        if action == "update":
            return dict(dashboard_update_user_plugin(**kwargs))
        return {"ok": False, "error": f"unsupported plugin action: {action}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def handle_install(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    identifier = str(body.get("identifier") or "").strip()
    if not identifier:
        return json_error(400, "identifier is required")
    payload = await asyncio.to_thread(
        _dashboard_plugin_action,
        "install",
        identifier=identifier,
        force=bool(body.get("force", False)),
        enable=bool(body.get("enable", True)),
    )
    return web.json_response(payload, status=200 if payload.get("ok") else 400)


async def handle_update(request: web.Request) -> web.Response:
    name = _ident(request)
    if not name:
        return json_error(400, "missing ?name= (or ?key=)")
    payload = await asyncio.to_thread(
        _dashboard_plugin_action, "update", name=name
    )
    return web.json_response(payload, status=200 if payload.get("ok") else 400)


async def handle_test(request: web.Request) -> web.Response:
    name = _ident(request)
    if not name:
        return json_error(400, "missing ?name= (or ?key=)")

    def discover() -> Dict[str, Any]:
        plugin = _find_plugin(name)
        if plugin is None:
            return {"ok": False, "error": f"plugin '{name}' was not discovered"}
        if plugin.get("error"):
            return {"ok": False, "error": str(plugin["error"]), "plugin": plugin}
        return {
            "ok": True,
            "plugin": plugin,
            "summary": {
                "tools": int(plugin.get("tools") or 0),
                "hooks": int(plugin.get("hooks") or 0),
                "commands": int(plugin.get("commands") or 0),
            },
        }

    payload = await asyncio.to_thread(discover)
    return web.json_response(payload, status=200 if payload.get("ok") else 400)


def register(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)

        return wrapped

    app.add_routes(
        [
            web.get("/hermes/plugins", profiled(handle_list)),
            web.post("/hermes/plugins/enable", profiled(handle_enable)),
            web.post("/hermes/plugins/disable", profiled(handle_disable)),
            web.post("/hermes/plugins/install", profiled(handle_install)),
            web.post("/hermes/plugins/update", profiled(handle_update)),
            web.post("/hermes/plugins/test", profiled(handle_test)),
            web.post("/hermes/plugins/uninstall", profiled(handle_uninstall)),
        ]
    )
