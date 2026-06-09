"""Read + toggle agent toolsets — thin wrapper over hermes-agent helpers.

Backs ``/hermes/tools/toolsets`` (see ``tools_routes``). Upstream already
exposes the same data via ``/api/tools/toolsets`` on the hermes-cli web
server; we replicate the shape here so the desktop UI can read it
through the backplane (which is always loopback-reachable) instead of
depending on ``hermes dashboard`` being running.

Toolsets are configured per-platform under ``platform_toolsets`` in
``~/.hermes/config.yaml``. We pin to the ``cli`` platform here because
that's the platform the desktop client runs the agent on — matches the
upstream ``/api/tools/toolsets`` choice.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Set

logger = logging.getLogger("my-browser-bridge")

# The desktop client runs the agent in CLI mode; toolset enable/disable
# is scoped to ``platform_toolsets.cli`` in config.yaml.
_PLATFORM = "cli"


def _load_config() -> Dict[str, Any]:
    from hermes_cli.config import load_config  # type: ignore

    cfg = load_config()
    return cfg if isinstance(cfg, dict) else {}


def _enabled_toolset_keys(config: Dict[str, Any]) -> Set[str]:
    from hermes_cli.tools_config import _get_platform_tools  # type: ignore

    return set(
        _get_platform_tools(config, _PLATFORM, include_default_mcp_servers=False)
    )


def _configurable_toolsets() -> List[tuple[str, str, str]]:
    from hermes_cli.tools_config import (  # type: ignore
        _get_effective_configurable_toolsets,
    )

    return list(_get_effective_configurable_toolsets())


def _toolset_tools(name: str) -> List[str]:
    try:
        from toolsets import resolve_toolset  # type: ignore

        return sorted(set(resolve_toolset(name)))
    except Exception as exc:  # noqa: BLE001
        logger.debug("resolve_toolset(%s) failed: %s", name, exc)
        return []


def _toolset_configured(name: str, config: Dict[str, Any]) -> bool:
    try:
        from hermes_cli.tools_config import _toolset_has_keys  # type: ignore

        return bool(_toolset_has_keys(name, config))
    except Exception as exc:  # noqa: BLE001
        logger.debug("_toolset_has_keys(%s) failed: %s", name, exc)
        return True


def list_toolsets() -> List[Dict[str, Any]]:
    """List configurable toolsets + their enabled/configured state.

    Shape mirrors upstream ``GET /api/tools/toolsets``: each entry is
    ``{name, label, description, enabled, available, configured, tools}``.
    """
    config = _load_config()
    enabled = _enabled_toolset_keys(config)
    result: List[Dict[str, Any]] = []
    for name, label, desc in _configurable_toolsets():
        is_enabled = name in enabled
        result.append(
            {
                "name": name,
                "label": label,
                "description": desc,
                "enabled": is_enabled,
                # ``available`` tracks runtime availability; upstream sets
                # it equal to ``enabled`` because a disabled toolset is
                # never registered into the model schema. We keep parity.
                "available": is_enabled,
                "configured": _toolset_configured(name, config),
                "tools": _toolset_tools(name),
            }
        )
    return result


def _tool_details(tool_names: List[str]) -> List[Dict[str, Any]]:
    """Per-tool ``{name, description, emoji}`` for a resolved toolset.

    Reads from the in-process :mod:`tools.registry` singleton — same data
    the agent ships to the LLM, so the UI is showing real, current tool
    metadata (not a stale config snapshot). Tools not in the registry
    (e.g. an MCP toolset whose server isn't connected in this process)
    fall back to ``{name}`` only.
    """
    try:
        from tools.registry import registry  # type: ignore
    except Exception as exc:  # noqa: BLE001
        logger.debug("tools.registry unavailable: %s", exc)
        return [{"name": n, "description": "", "emoji": ""} for n in tool_names]

    out: List[Dict[str, Any]] = []
    for tool_name in tool_names:
        entry = registry.get_entry(tool_name)
        if entry is None:
            out.append({"name": tool_name, "description": "", "emoji": ""})
            continue
        # ``entry.description`` is what the agent registered; fall back
        # to the OpenAI-format ``schema.description`` because some tools
        # only set the latter.
        desc = entry.description or ""
        if not desc and isinstance(entry.schema, dict):
            desc = str(entry.schema.get("description") or "")
        out.append(
            {
                "name": entry.name,
                "description": desc,
                "emoji": entry.emoji or "",
            }
        )
    return out


def _provider_matrix(name: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Provider rows for a toolset, mirroring upstream
    ``GET /api/tools/toolsets/{name}/config`` shape.

    Each provider: ``{name, badge, tag, env_vars, post_setup,
    requires_nous_auth}``. ``env_vars`` items carry an ``is_set`` flag
    so the UI can mark missing credentials without ever exposing the
    actual value over HTTP.
    """
    try:
        from hermes_cli.tools_config import (  # type: ignore
            TOOL_CATEGORIES,
            _visible_providers,
        )
        from hermes_cli.config import get_env_value  # type: ignore
    except Exception as exc:  # noqa: BLE001
        logger.debug("tools_config provider helpers unavailable: %s", exc)
        return []

    cat = TOOL_CATEGORIES.get(name)
    if not cat:
        return []
    providers: List[Dict[str, Any]] = []
    try:
        rows = _visible_providers(cat, config, force_fresh=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("_visible_providers(%s) failed: %s", name, exc)
        return []
    for prov in rows:
        env_vars = [
            {
                "key": e.get("key"),
                "prompt": e.get("prompt", e.get("key")),
                "url": e.get("url"),
                "default": e.get("default"),
                "is_set": bool(get_env_value(e.get("key"))) if e.get("key") else False,
            }
            for e in prov.get("env_vars", [])
            if isinstance(e, dict)
        ]
        providers.append(
            {
                "name": prov.get("name", ""),
                "badge": prov.get("badge", ""),
                "tag": prov.get("tag", ""),
                "env_vars": env_vars,
                "post_setup": prov.get("post_setup"),
                "requires_nous_auth": bool(prov.get("requires_nous_auth")),
            }
        )
    return providers


def _has_category(name: str) -> bool:
    """True when the toolset has a ``TOOL_CATEGORIES`` provider entry."""
    try:
        from hermes_cli.tools_config import TOOL_CATEGORIES  # type: ignore

        return name in TOOL_CATEGORIES
    except Exception:  # noqa: BLE001
        return False


def get_toolset_detail(name: str) -> Dict[str, Any]:
    """Extended detail for a single toolset.

    Returns ``{ok, toolset?, error?}``. The ``toolset`` payload extends
    the list-row shape with per-tool ``items`` and the provider matrix
    so the UI's detail dialog can render everything in one fetch.
    """
    valid = {ts_key: (label, desc) for ts_key, label, desc in _configurable_toolsets()}
    if name not in valid:
        return {"ok": False, "error": f"Unknown toolset: {name}"}

    config = _load_config()
    enabled = name in _enabled_toolset_keys(config)
    label, description = valid[name]
    tool_names = _toolset_tools(name)
    return {
        "ok": True,
        "toolset": {
            "name": name,
            "label": label,
            "description": description,
            "enabled": enabled,
            "available": enabled,
            "configured": _toolset_configured(name, config),
            "tools": tool_names,
            "items": _tool_details(tool_names),
            "providers": _provider_matrix(name, config),
            "has_category": _has_category(name),
        },
    }


def toggle_toolset(name: str, enabled: bool) -> Dict[str, Any]:
    """Enable or disable a toolset for the ``cli`` platform.

    Returns ``{ok: True, name, enabled}`` on success, or
    ``{ok: False, error}`` for an unknown toolset key. Persists via the
    same helper the CLI ``hermes tools`` picker uses so GUI and CLI stay
    in lockstep.
    """
    from hermes_cli.tools_config import _save_platform_tools  # type: ignore

    valid = {ts_key for ts_key, _, _ in _configurable_toolsets()}
    if name not in valid:
        return {"ok": False, "error": f"Unknown toolset: {name}"}

    config = _load_config()
    current = _enabled_toolset_keys(config)
    if enabled:
        current.add(name)
    else:
        current.discard(name)
    _save_platform_tools(config, _PLATFORM, current)
    return {"ok": True, "name": name, "enabled": enabled}


# ---------------------------------------------------------------------------
# Installed MCP servers (from config.yaml/mcp_servers)
#
# Separate read path from the toolset list above: built-in toolsets live in
# ``CONFIGURABLE_TOOLSETS`` (always present), while MCP servers are user-
# added entries the agent doesn't see until the next session. The UI
# renders them as their own group so the user can tell "I added this"
# apart from "this ships with the agent".
# ---------------------------------------------------------------------------


def _curated_slugs() -> Set[str]:
    """Slugs of every entry in optional-mcps/ — used to tag installed MCPs."""
    try:
        from hermes_cli.mcp_catalog import list_catalog  # type: ignore

        return {entry.name for entry in list_catalog()}
    except Exception as exc:  # noqa: BLE001
        logger.debug("list_catalog() failed for tagging: %s", exc)
        return set()


def _transport_kind(server_cfg: Dict[str, Any]) -> str:
    """Best-effort transport kind from an installed MCP server's config."""
    if not isinstance(server_cfg, dict):
        return ""
    if "url" in server_cfg:
        return "http"
    if "command" in server_cfg:
        return "stdio"
    return ""


def _mcp_is_enabled(server_cfg: Dict[str, Any]) -> bool:
    """Mirror of ``mcp_catalog.is_enabled``'s tolerant truthy parse."""
    if not isinstance(server_cfg, dict):
        return False
    val = server_cfg.get("enabled", True)
    if isinstance(val, str):
        return val.lower() in {"true", "1", "yes"}
    return bool(val)


def list_installed_mcps() -> List[Dict[str, Any]]:
    """Return the user's installed MCP servers as normalized list items.

    Schema:
      {
        slug,                   # mcp_servers key in config.yaml
        label,                  # same as slug today (the saved record
                                # has no human-friendly label)
        description,            # carried through from server_cfg.description
        source,                 # "curated" if slug matches an optional-mcps
                                # entry, otherwise "manual"
        installed: True,
        enabled,                # tolerant truthy parse, default True
        transport_kind,         # "stdio" | "http" | ""
      }
    """
    cfg = _load_config()
    servers = cfg.get("mcp_servers") if isinstance(cfg, dict) else None
    if not isinstance(servers, dict):
        return []
    curated = _curated_slugs()
    out: List[Dict[str, Any]] = []
    for slug, server_cfg in servers.items():
        if not isinstance(server_cfg, dict):
            # Tolerate hand-edited config.yaml that drops a non-mapping
            # under mcp_servers.<name>; surface the row so the user can
            # find and fix it instead of silently hiding it.
            server_cfg = {}
        source = "curated" if slug in curated else "manual"
        out.append(
            {
                "slug": slug,
                "label": slug,
                "description": str(server_cfg.get("description") or ""),
                "source": source,
                "installed": True,
                "enabled": _mcp_is_enabled(server_cfg),
                "transport_kind": _transport_kind(server_cfg),
            }
        )
    out.sort(key=lambda r: r["slug"])
    return out
