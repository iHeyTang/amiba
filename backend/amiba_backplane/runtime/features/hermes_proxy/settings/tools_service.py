"""Amiba-owned adapter for Hermes capability configuration.

The desktop must not patch the Hermes source tree.  This module imports the
same public configuration helpers used by ``hermes tools`` and exposes a
small, JSON-safe contract for the Amiba capability centre:

* discover and enable/disable toolsets;
* choose a provider;
* save allow-listed provider credentials without reading secret values back;
* choose image/video generation models;
* run an allow-listed provider setup action.

All persistent writes still land in the selected Profile's canonical stores
(``$HERMES_HOME/config.yaml`` and ``$HERMES_HOME/.env``).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

from ....adapters.dotenv_local import merge_dotenv_file_and_apply
from ....adapters.hermes_core import is_default_profile

logger = logging.getLogger("my-browser-bridge")

_DEFAULT_PLATFORM = "cli"
_MODEL_CATALOG_TOOLSETS = {
    "image_gen": "image_gen",
    "video_gen": "video_gen",
}
_TERMINAL_BACKENDS: List[Dict[str, Any]] = [
    {
        "name": "local",
        "label": "Local",
        "description": "Run commands directly on this machine. No isolation.",
        "fields": [],
    },
    {
        "name": "docker",
        "label": "Docker",
        "description": "Run commands in an isolated Docker container.",
        "fields": [
            {
                "key": "TERMINAL_DOCKER_IMAGE",
                "prompt": "Container image",
                "default": "nikolaik/python-nodejs:python3.11-nodejs20",
                "secret": False,
            }
        ],
    },
    {
        "name": "singularity",
        "label": "Singularity / Apptainer",
        "description": "Run commands in a rootless HPC-friendly container.",
        "fields": [
            {
                "key": "TERMINAL_SINGULARITY_IMAGE",
                "prompt": "Container image",
                "default": "docker://nikolaik/python-nodejs:python3.11-nodejs20",
                "secret": False,
            }
        ],
    },
    {
        "name": "modal",
        "label": "Modal",
        "description": "Run commands in a Modal cloud sandbox.",
        "fields": [
            {
                "key": "MODAL_TOKEN_ID",
                "prompt": "Modal token ID",
                "url": "https://modal.com/settings",
                "secret": True,
            },
            {
                "key": "MODAL_TOKEN_SECRET",
                "prompt": "Modal token secret",
                "url": "https://modal.com/settings",
                "secret": True,
            },
            {
                "key": "TERMINAL_MODAL_IMAGE",
                "prompt": "Container image",
                "secret": False,
            },
        ],
    },
    {
        "name": "daytona",
        "label": "Daytona",
        "description": "Run commands in a persistent Daytona cloud sandbox.",
        "fields": [
            {
                "key": "DAYTONA_API_KEY",
                "prompt": "Daytona API key",
                "url": "https://app.daytona.io/",
                "secret": True,
            },
            {
                "key": "TERMINAL_DAYTONA_IMAGE",
                "prompt": "Container image",
                "secret": False,
            },
        ],
    },
    {
        "name": "ssh",
        "label": "SSH",
        "description": "Run commands on a remote host over SSH.",
        "fields": [
            {
                "key": "TERMINAL_SSH_HOST",
                "prompt": "Host",
                "secret": False,
            },
            {
                "key": "TERMINAL_SSH_USER",
                "prompt": "User",
                "secret": False,
            },
            {
                "key": "TERMINAL_SSH_PORT",
                "prompt": "Port",
                "default": "22",
                "secret": False,
            },
            {
                "key": "TERMINAL_SSH_KEY",
                "prompt": "Private key path",
                "secret": False,
            },
        ],
    },
]
_TERMINAL_BACKEND_NAMES = {
    str(row["name"]) for row in _TERMINAL_BACKENDS
}


def _load_config() -> Dict[str, Any]:
    from hermes_cli.config import load_config  # type: ignore

    cfg = load_config()
    return cfg if isinstance(cfg, dict) else {}


def _save_config(config: Dict[str, Any]) -> None:
    from hermes_cli.config import save_config  # type: ignore

    save_config(config)


def _configurable_toolsets() -> List[tuple[str, str, str]]:
    from hermes_cli.tools_config import (  # type: ignore
        _get_effective_configurable_toolsets,
    )

    return list(_get_effective_configurable_toolsets())


def _toolset_platform(name: str) -> str:
    """Return the platform whose toolset list owns *name*.

    New Hermes releases expose platform-restricted native toolsets.  Older
    versions configured every row under ``cli``; retain that fallback so the
    adapter continues to work during staggered upgrades.
    """

    try:
        from hermes_cli.tools_config import (  # type: ignore
            _toolset_configuration_platform,
        )

        return str(_toolset_configuration_platform(name) or _DEFAULT_PLATFORM)
    except Exception:
        return _DEFAULT_PLATFORM


def _platform_label(platform: str) -> str:
    try:
        from hermes_cli.platforms import platform_label  # type: ignore

        return _gui_label(platform_label(platform, platform))
    except Exception:
        return platform


def _gui_label(label: str) -> str:
    """Use Hermes' GUI label normalizer when available (drops emoji prefixes)."""

    try:
        from hermes_cli.tools_config import gui_toolset_label  # type: ignore

        return str(gui_toolset_label(label))
    except Exception:
        text = str(label or "").strip()
        parts = text.split(None, 1)
        if (
            len(parts) == 2
            and parts[0]
            and not any(ch.isascii() and ch.isalnum() for ch in parts[0])
        ):
            return parts[1].strip()
        return text


def _enabled_toolset_keys(config: Dict[str, Any], platform: str) -> Set[str]:
    from hermes_cli.tools_config import _get_platform_tools  # type: ignore

    return set(
        _get_platform_tools(
            config,
            platform,
            include_default_mcp_servers=False,
        )
    )


def _toolset_tools(name: str) -> List[str]:
    try:
        from toolsets import resolve_toolset  # type: ignore

        return sorted(set(resolve_toolset(name)))
    except Exception as exc:  # noqa: BLE001
        logger.debug("resolve_toolset(%s) failed: %s", name, exc)
        return []


def _auxiliary_model(config: Dict[str, Any], slot_name: str) -> str:
    auxiliary = config.get("auxiliary")
    auxiliary = auxiliary if isinstance(auxiliary, dict) else {}
    slot = auxiliary.get(slot_name)
    if not isinstance(slot, dict):
        return ""
    return str(slot.get("model") or "").strip()


def _main_model_supports_vision(config: Dict[str, Any]) -> bool:
    model_config = config.get("model")
    model_config = model_config if isinstance(model_config, dict) else {}
    provider = str(model_config.get("provider") or "").strip()
    model = str(
        model_config.get("default") or model_config.get("model") or ""
    ).strip()
    if not model:
        return False
    try:
        from agent.models_dev import get_model_capabilities  # type: ignore

        capabilities = get_model_capabilities(provider=provider, model=model)
        return bool(
            capabilities
            and getattr(capabilities, "supports_vision", False)
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug(
            "Could not resolve vision support for %s/%s: %s",
            provider,
            model,
            exc,
        )
        return False


def _toolset_configured(name: str, config: Dict[str, Any]) -> bool:
    """Return whether the *currently usable path* for a capability is ready.

    Hermes's upstream ``_toolset_has_keys`` is intentionally permissive: a
    keyless provider row is enough to return true even when that provider
    still needs a package install, login, or other setup step. That is useful
    to the CLI's setup wizard, but it is not an honest status for Amiba's
    capability page. The GUI treats provider readiness as the source of truth
    and only falls back to the upstream helper for toolsets without a provider
    category.
    """
    if name == "terminal":
        raw_terminal = config.get("terminal")
        terminal_config = (
            raw_terminal if isinstance(raw_terminal, dict) else {}
        )
        backend = str(
            terminal_config.get("backend") or "local"
        ).strip().lower()
        if backend not in _TERMINAL_BACKEND_NAMES:
            backend = "local"
        status, _detail = _probe_terminal_backend(backend, terminal_config)
        return status == "ready"

    # Image and video understanding are model-backed, not API-key-backed.
    # Treat an explicit vision route as ready; otherwise only claim the main
    # route is ready when Hermes's own model metadata confirms image input.
    if name == "vision":
        return bool(
            _auxiliary_model(config, "vision")
            or _main_model_supports_vision(config)
        )

    # Hermes's video handler uses the configured vision model. It does read an
    # ``AUXILIARY_VIDEO_MODEL`` process override first, but current Hermes
    # config bridging does not persist or export an ``auxiliary.video`` slot.
    # Do not expose a setting that would appear saved but have no runtime
    # effect. With no vision route selected we also cannot honestly claim the
    # active model accepts video input, because models.dev currently exposes
    # no stable ``supports_video`` flag.
    if name == "video":
        return bool(_auxiliary_model(config, "vision"))

    providers, _active_provider = _provider_matrix(name, config)
    if providers:
        ready = [p for p in providers if p.get("status") == "ready"]
        if name == "web":
            # Search and extraction are independent routes. A provider without
            # an explicit capability list is a legacy row that supports both.
            def supports(provider: Dict[str, Any], lane: str) -> bool:
                lanes = provider.get("capabilities")
                return not lanes or lane in lanes

            return any(supports(p, "search") for p in ready) and any(
                supports(p, "extract") for p in ready
            )
        return bool(ready)

    try:
        from hermes_cli.tools_config import _toolset_has_keys  # type: ignore

        return bool(_toolset_has_keys(name, config))
    except Exception as exc:  # noqa: BLE001
        logger.debug("_toolset_has_keys(%s) failed: %s", name, exc)
        return True


def list_toolsets() -> List[Dict[str, Any]]:
    """List configurable capabilities with their user-visible readiness."""

    config = _load_config()
    enabled_by_platform: Dict[str, Set[str]] = {}
    result: List[Dict[str, Any]] = []
    for name, label, desc in _configurable_toolsets():
        platform = _toolset_platform(name)
        if platform not in enabled_by_platform:
            enabled_by_platform[platform] = _enabled_toolset_keys(config, platform)
        is_enabled = name in enabled_by_platform[platform]
        result.append(
            {
                "name": name,
                "label": _gui_label(label),
                "description": str(desc or ""),
                "platform": platform,
                "platform_label": _platform_label(platform),
                "enabled": is_enabled,
                "available": is_enabled,
                "configured": _toolset_configured(name, config),
                "tools": _toolset_tools(name),
            }
        )
    return result


def _tool_details(tool_names: List[str]) -> List[Dict[str, Any]]:
    """Return the same descriptions the runtime registers with the model."""

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


def _visible_provider_rows(name: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        from hermes_cli.tools_config import (  # type: ignore
            TOOL_CATEGORIES,
            _visible_providers,
        )

        category = TOOL_CATEGORIES.get(name)
        if not category:
            return []
        return list(_visible_providers(category, config, force_fresh=True))
    except Exception as exc:  # noqa: BLE001
        logger.warning("_visible_providers(%s) failed: %s", name, exc)
        return []


def _provider_is_active(provider: Dict[str, Any], config: Dict[str, Any]) -> bool:
    try:
        from hermes_cli.tools_config import _is_provider_active  # type: ignore

        return bool(_is_provider_active(provider, config, force_fresh=True))
    except Exception:
        env_vars = provider.get("env_vars") or []
        return bool(
            env_vars
            and all(
                os.environ.get(str(row.get("key") or ""), "")
                for row in env_vars
                if isinstance(row, dict)
            )
        )


def _provider_status(
    provider: Dict[str, Any],
    config: Dict[str, Any],
    *,
    is_active: bool,
    features: Any = None,
) -> str:
    try:
        from hermes_cli.tools_config import provider_readiness_status  # type: ignore

        return str(
            provider_readiness_status(
                provider,
                config,
                features=features,
                is_active=is_active,
            )
            or "inactive"
        )
    except Exception:
        env_vars = [
            row
            for row in provider.get("env_vars", [])
            if isinstance(row, dict) and row.get("key")
        ]
        if env_vars and not all(
            _env_key_is_set(str(row["key"])) for row in env_vars
        ):
            return "needs_key"
        if provider.get("requires_nous_auth"):
            return "needs_auth"
        if provider.get("post_setup") and not is_active:
            return "needs_setup"
        return "ready" if is_active or not env_vars else "inactive"


def _env_key_is_set(key: str) -> bool:
    try:
        from hermes_cli.config import get_env_value  # type: ignore

        return bool(get_env_value(key))
    except Exception:
        return bool(os.environ.get(key))


def _subscription_features(config: Dict[str, Any]) -> Any:
    try:
        from hermes_cli.nous_subscription import (  # type: ignore
            get_nous_subscription_features,
        )

        return get_nous_subscription_features(config, force_fresh=True)
    except Exception:
        return None


def _provider_matrix(
    name: str,
    config: Dict[str, Any],
) -> tuple[List[Dict[str, Any]], Optional[str]]:
    rows = _visible_provider_rows(name, config)
    features = _subscription_features(config) if rows else None
    providers: List[Dict[str, Any]] = []
    active_provider: Optional[str] = None

    for provider in rows:
        env_vars = []
        for raw in provider.get("env_vars", []):
            if not isinstance(raw, dict):
                continue
            key = raw.get("key")
            env_vars.append(
                {
                    "key": key,
                    "prompt": raw.get("prompt", key),
                    "url": raw.get("url"),
                    "default": raw.get("default"),
                    "is_set": bool(key and _env_key_is_set(str(key))),
                }
            )

        is_active = _provider_is_active(provider, config)
        if is_active and active_provider is None:
            active_provider = str(provider.get("name") or "")
        item: Dict[str, Any] = {
            "name": str(provider.get("name") or ""),
            "badge": str(provider.get("badge") or ""),
            "tag": str(provider.get("tag") or ""),
            "env_vars": env_vars,
            "post_setup": provider.get("post_setup"),
            "requires_nous_auth": bool(provider.get("requires_nous_auth")),
            "is_active": is_active,
            "status": _provider_status(
                provider,
                config,
                is_active=is_active,
                features=features,
            ),
        }
        for key in (
            "web_backend",
            "tts_provider",
            "browser_provider",
            "image_gen_plugin_name",
            "video_gen_plugin_name",
        ):
            if provider.get(key):
                item[key] = provider[key]
        if name == "web" and provider.get("web_backend"):
            try:
                from hermes_cli.tools_config import (  # type: ignore
                    web_provider_capabilities,
                )

                item["capabilities"] = list(
                    web_provider_capabilities(provider["web_backend"])
                )
            except Exception:
                item["capabilities"] = ["search", "extract"]
        providers.append(item)
    return providers, active_provider


def _toolset_category_meta(name: str) -> Dict[str, Any]:
    try:
        from hermes_cli.tools_config import TOOL_CATEGORIES  # type: ignore

        category = TOOL_CATEGORIES.get(name)
        if not isinstance(category, dict):
            return {}
        return {
            "setup_title": str(category.get("setup_title") or ""),
            "setup_note": str(category.get("setup_note") or ""),
        }
    except Exception:
        return {}


def _active_web_backends() -> tuple[Optional[str], Optional[str]]:
    try:
        from tools.web_tools import _get_extract_backend, _get_search_backend  # type: ignore

        return _get_search_backend(), _get_extract_backend()
    except Exception:
        return None, None


def get_toolset_detail(name: str) -> Dict[str, Any]:
    """Return one capability with provider readiness and advanced tool data."""

    valid = {
        ts_key: (label, desc)
        for ts_key, label, desc in _configurable_toolsets()
    }
    if name not in valid:
        return {"ok": False, "error": f"Unknown toolset: {name}"}

    config = _load_config()
    platform = _toolset_platform(name)
    enabled = name in _enabled_toolset_keys(config, platform)
    label, description = valid[name]
    tool_names = _toolset_tools(name)
    providers, active_provider = _provider_matrix(name, config)
    meta = _toolset_category_meta(name)
    payload: Dict[str, Any] = {
        "name": name,
        "label": _gui_label(label),
        "description": str(description or ""),
        "platform": platform,
        "platform_label": _platform_label(platform),
        "enabled": enabled,
        "available": enabled,
        "configured": _toolset_configured(name, config),
        "tools": tool_names,
        "items": _tool_details(tool_names),
        "providers": providers,
        "has_category": bool(providers),
        "active_provider": active_provider,
        **meta,
    }
    if name == "web":
        search_backend, extract_backend = _active_web_backends()
        payload["active_search_backend"] = search_backend
        payload["active_extract_backend"] = extract_backend
    return {"ok": True, "toolset": payload}


def toggle_toolset(name: str, enabled: bool) -> Dict[str, Any]:
    """Enable or disable a capability in its owning platform."""

    from hermes_cli.tools_config import _save_platform_tools  # type: ignore

    valid = {ts_key for ts_key, _, _ in _configurable_toolsets()}
    if name not in valid:
        return {"ok": False, "error": f"Unknown toolset: {name}"}

    platform = _toolset_platform(name)
    config = _load_config()
    current = _enabled_toolset_keys(config, platform)
    if enabled:
        current.add(name)
    else:
        current.discard(name)
    _save_platform_tools(config, platform, current)
    return {
        "ok": True,
        "name": name,
        "platform": platform,
        "enabled": enabled,
    }


def select_toolset_provider(
    name: str,
    provider_name: str,
    *,
    capability: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist a provider choice without prompting or touching credentials."""

    from hermes_cli.tools_config import apply_provider_selection  # type: ignore

    valid = {ts_key for ts_key, _, _ in _configurable_toolsets()}
    if name not in valid:
        raise ValueError(f"Unknown toolset: {name}")

    config = _load_config()
    rows = _visible_provider_rows(name, config)
    provider = next(
        (row for row in rows if str(row.get("name") or "") == provider_name),
        None,
    )
    if provider is None:
        raise ValueError(f"Unknown provider {provider_name!r} for toolset {name!r}")

    if capability is not None:
        if name != "web" or capability not in {"search", "extract"}:
            raise ValueError("capability must be 'search' or 'extract' for web")
        backend = str(provider.get("web_backend") or "")
        if not backend:
            raise ValueError(f"{provider_name} cannot provide web {capability}")
        try:
            from hermes_cli.tools_config import (  # type: ignore
                web_provider_capabilities,
            )

            supported = set(web_provider_capabilities(backend))
        except Exception:
            supported = {"search", "extract"}
        if capability not in supported:
            raise ValueError(f"{provider_name} does not support {capability}")
        web_cfg = config.setdefault("web", {})
        if not isinstance(web_cfg, dict):
            web_cfg = {}
            config["web"] = web_cfg
        web_cfg[f"{capability}_backend"] = backend
    else:
        try:
            apply_provider_selection(name, provider_name, config)
        except KeyError as exc:
            raise ValueError(str(exc).strip('"')) from exc

    _save_config(config)
    return {
        "ok": True,
        "name": name,
        "provider": provider_name,
        **({"capability": capability} if capability else {}),
    }


def save_toolset_env(name: str, values: Dict[str, Any]) -> Dict[str, Any]:
    """Save only env keys declared by a visible provider for this toolset."""

    valid = {ts_key for ts_key, _, _ in _configurable_toolsets()}
    if name not in valid:
        raise ValueError(f"Unknown toolset: {name}")

    config = _load_config()
    allowed: Set[str] = set()
    for provider in _visible_provider_rows(name, config):
        for row in provider.get("env_vars", []):
            if isinstance(row, dict) and row.get("key"):
                allowed.add(str(row["key"]))

    unknown = sorted(str(key) for key in values if key not in allowed)
    if unknown:
        raise ValueError(
            f"Unknown env var(s) for toolset {name}: {', '.join(unknown)}"
        )

    updates: Dict[str, str] = {}
    skipped: List[str] = []
    for key, raw_value in values.items():
        if not isinstance(raw_value, str):
            raise ValueError(f"value for {key!r} must be string")
        value = raw_value.strip()
        if not value:
            skipped.append(key)
            continue
        updates[key] = value

    if updates:
        merge_dotenv_file_and_apply(
            updates,
            apply_process=is_default_profile(),
        )
    return {
        "ok": True,
        "name": name,
        "saved": sorted(updates),
        "skipped": sorted(skipped),
        "is_set": {key: _env_key_is_set(key) for key in sorted(allowed)},
    }


def _find_provider_row(
    name: str,
    config: Dict[str, Any],
    provider_name: Optional[str],
) -> Optional[Dict[str, Any]]:
    rows = _visible_provider_rows(name, config)
    if provider_name:
        return next(
            (
                row
                for row in rows
                if str(row.get("name") or "") == provider_name
            ),
            None,
        )
    return next(
        (row for row in rows if _provider_is_active(row, config)),
        None,
    )


def _model_plugin(name: str, provider: Dict[str, Any]) -> Optional[str]:
    if name == "image_gen":
        value = provider.get("image_gen_plugin_name")
        if value:
            return str(value)
        if provider.get("imagegen_backend"):
            return "fal"
    if name == "video_gen" and provider.get("video_gen_plugin_name"):
        return str(provider["video_gen_plugin_name"])
    return None


def _model_catalog(name: str, plugin: str) -> tuple[Dict[str, Any], str]:
    from hermes_cli.tools_config import (  # type: ignore
        _plugin_image_gen_catalog,
        _plugin_video_gen_catalog,
    )

    if name == "image_gen":
        catalog, default = _plugin_image_gen_catalog(plugin)
    else:
        catalog, default = _plugin_video_gen_catalog(plugin)
    return dict(catalog or {}), str(default or "")


def get_toolset_models(
    name: str,
    provider_name: Optional[str] = None,
) -> Dict[str, Any]:
    section = _MODEL_CATALOG_TOOLSETS.get(name)
    if section is None:
        return {
            "ok": True,
            "name": name,
            "has_models": False,
            "models": [],
            "current": None,
            "default": None,
        }

    config = _load_config()
    provider = _find_provider_row(name, config, provider_name)
    plugin = _model_plugin(name, provider or {}) if provider else None
    if not provider or not plugin:
        return {
            "ok": True,
            "name": name,
            "has_models": False,
            "models": [],
            "current": None,
            "default": None,
        }

    catalog, default = _model_catalog(name, plugin)
    section_cfg = config.get(section)
    current = (
        str(section_cfg.get("model") or "").strip()
        if isinstance(section_cfg, dict)
        else ""
    )
    if current not in catalog:
        current = default if default in catalog else ""
    models = [
        {
            "id": model_id,
            "display": str(meta.get("display") or model_id)
            if isinstance(meta, dict)
            else model_id,
            "speed": str(meta.get("speed") or "")
            if isinstance(meta, dict)
            else "",
            "strengths": str(meta.get("strengths") or "")
            if isinstance(meta, dict)
            else "",
            "price": str(meta.get("price") or "")
            if isinstance(meta, dict)
            else "",
        }
        for model_id, meta in catalog.items()
    ]
    return {
        "ok": True,
        "name": name,
        "has_models": bool(models),
        "provider": str(provider.get("name") or ""),
        "plugin": plugin,
        "models": models,
        "current": current or None,
        "default": default or None,
    }


def select_toolset_model(
    name: str,
    model_id: str,
    *,
    provider_name: Optional[str] = None,
) -> Dict[str, Any]:
    section = _MODEL_CATALOG_TOOLSETS.get(name)
    if section is None:
        raise ValueError(f"Toolset has no model catalog: {name}")

    config = _load_config()
    provider = _find_provider_row(name, config, provider_name)
    plugin = _model_plugin(name, provider or {}) if provider else None
    if not provider or not plugin:
        raise ValueError(f"No model-capable provider is active for {name}")

    catalog, _default = _model_catalog(name, plugin)
    if model_id not in catalog:
        raise ValueError(f"Unknown model {model_id!r} for provider {plugin!r}")

    section_cfg = config.setdefault(section, {})
    if not isinstance(section_cfg, dict):
        section_cfg = {}
        config[section] = section_cfg
    section_cfg["model"] = model_id
    _save_config(config)
    return {
        "ok": True,
        "name": name,
        "model": model_id,
        "plugin": plugin,
    }


def _declared_post_setup_keys(name: str, config: Dict[str, Any]) -> Set[str]:
    return {
        str(provider["post_setup"])
        for provider in _visible_provider_rows(name, config)
        if provider.get("post_setup")
    }


def run_toolset_post_setup(name: str, key: str) -> Dict[str, Any]:
    """Run a declared Hermes setup action in the backplane's own environment."""

    valid = {ts_key for ts_key, _, _ in _configurable_toolsets()}
    if name not in valid:
        raise ValueError(f"Unknown toolset: {name}")
    config = _load_config()
    if key not in _declared_post_setup_keys(name, config):
        raise ValueError(f"Unknown post-setup key {key!r} for toolset {name!r}")

    command = [
        sys.executable,
        "-m",
        "hermes_cli.main",
        "tools",
        "post-setup",
        key,
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=dict(os.environ),
    )
    output = "\n".join(
        part.strip()
        for part in (completed.stdout, completed.stderr)
        if part and part.strip()
    )
    if completed.returncode != 0:
        raise RuntimeError(
            output[-4000:] or f"Setup action exited with {completed.returncode}"
        )
    return {
        "ok": True,
        "name": name,
        "key": key,
        "output": output[-4000:],
    }


# ---------------------------------------------------------------------------
# Terminal execution backend
# ---------------------------------------------------------------------------


def _terminal_config_value(
    terminal_config: Dict[str, Any],
    config_key: str,
    env_key: str,
) -> str:
    value = terminal_config.get(config_key)
    if value is not None and str(value).strip():
        return str(value).strip()
    try:
        from hermes_cli.config import get_env_value  # type: ignore

        return str(get_env_value(env_key) or "").strip()
    except Exception:
        return str(os.environ.get(env_key) or "").strip()


def _probe_terminal_backend(
    name: str,
    terminal_config: Dict[str, Any],
) -> tuple[str, str]:
    """Fast, defensive readiness probe for one supported backend."""

    try:
        if name == "local":
            return "ready", ""
        if name == "docker":
            if not shutil.which("docker"):
                return "needs_setup", "Docker CLI was not found."
            result = subprocess.run(
                ["docker", "info", "--format", "{{.ServerVersion}}"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            if result.returncode == 0:
                return "ready", ""
            return "needs_setup", "Docker is installed, but its daemon is not running."
        if name == "singularity":
            if shutil.which("singularity") or shutil.which("apptainer"):
                return "ready", ""
            return "needs_setup", "Install Singularity or Apptainer first."
        if name == "modal":
            if _env_key_is_set("MODAL_TOKEN_ID") and _env_key_is_set(
                "MODAL_TOKEN_SECRET"
            ):
                return "ready", ""
            return "needs_setup", "Enter a Modal token ID and secret."
        if name == "daytona":
            if _env_key_is_set("DAYTONA_API_KEY"):
                return "ready", ""
            return "needs_setup", "Enter a Daytona API key."
        if name == "ssh":
            host = _terminal_config_value(
                terminal_config,
                "ssh_host",
                "TERMINAL_SSH_HOST",
            )
            user = _terminal_config_value(
                terminal_config,
                "ssh_user",
                "TERMINAL_SSH_USER",
            )
            if host and user:
                return "ready", f"{user}@{host}"
            return "needs_setup", "Enter both the SSH host and user."
        return "unavailable", f"Unknown backend: {name}"
    except subprocess.TimeoutExpired:
        return "needs_setup", "The backend readiness check timed out."
    except Exception as exc:  # noqa: BLE001
        return "unavailable", f"Readiness check failed: {exc}"


def get_terminal_backends() -> Dict[str, Any]:
    """Return selectable terminal backends without exposing stored values."""

    config = _load_config()
    raw_terminal = config.get("terminal")
    terminal_config = raw_terminal if isinstance(raw_terminal, dict) else {}
    active = str(terminal_config.get("backend") or "local").strip().lower()
    if active not in _TERMINAL_BACKEND_NAMES:
        active = "local"

    rows: List[Dict[str, Any]] = []
    for metadata in _TERMINAL_BACKENDS:
        name = str(metadata["name"])
        status, detail = _probe_terminal_backend(name, terminal_config)
        fields = [
            {
                **field,
                "is_set": _env_key_is_set(str(field["key"])),
            }
            for field in metadata.get("fields", [])
        ]
        rows.append(
            {
                "name": name,
                "label": metadata["label"],
                "description": metadata["description"],
                "active": name == active,
                "status": status,
                "detail": detail,
                "fields": fields,
            }
        )
    return {"ok": True, "active": active, "backends": rows}


def select_terminal_backend(name: str) -> Dict[str, Any]:
    backend = str(name or "").strip().lower()
    if backend not in _TERMINAL_BACKEND_NAMES:
        raise ValueError(f"Unknown terminal backend: {name!r}")
    config = _load_config()
    terminal_config = config.setdefault("terminal", {})
    if not isinstance(terminal_config, dict):
        terminal_config = {}
        config["terminal"] = terminal_config
    terminal_config["backend"] = backend
    _save_config(config)
    return {"ok": True, "backend": backend}


def save_terminal_env(values: Dict[str, Any]) -> Dict[str, Any]:
    """Persist only the small terminal field allow-list exposed above."""

    allowed = {
        str(field["key"])
        for backend in _TERMINAL_BACKENDS
        for field in backend.get("fields", [])
    }
    unknown = sorted(str(key) for key in values if key not in allowed)
    if unknown:
        raise ValueError(
            f"Unknown terminal setting(s): {', '.join(unknown)}"
        )

    updates: Dict[str, str] = {}
    skipped: List[str] = []
    for key, raw_value in values.items():
        if not isinstance(raw_value, str):
            raise ValueError(f"value for {key!r} must be string")
        value = raw_value.strip()
        if value:
            updates[key] = value
        else:
            skipped.append(key)
    if updates:
        merge_dotenv_file_and_apply(
            updates,
            apply_process=is_default_profile(),
        )
    return {
        "ok": True,
        "saved": sorted(updates),
        "skipped": sorted(skipped),
        "is_set": {key: _env_key_is_set(key) for key in sorted(allowed)},
    }


# ---------------------------------------------------------------------------
# Computer-use driver readiness and permissions
# ---------------------------------------------------------------------------


def get_computer_use_status() -> Dict[str, Any]:
    from tools.computer_use.permissions import computer_use_status  # type: ignore

    result = computer_use_status()
    if not isinstance(result, dict):
        raise RuntimeError("Hermes returned an invalid computer-use status")
    return {"ok": True, **result}


def grant_computer_use_permissions() -> Dict[str, Any]:
    """Start Hermes' static macOS permission flow and return immediately."""

    if sys.platform != "darwin":
        raise ValueError("Computer-use permission grants are only needed on macOS")
    process = subprocess.Popen(  # noqa: S603 - fixed, non-user-controlled argv
        [
            sys.executable,
            "-m",
            "hermes_cli.main",
            "computer-use",
            "permissions",
            "grant",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=dict(os.environ),
        start_new_session=True,
        close_fds=True,
    )
    return {"ok": True, "pid": process.pid}


# ---------------------------------------------------------------------------
# Installed MCP servers (from config.yaml/mcp_servers)
# ---------------------------------------------------------------------------


def _curated_slugs() -> Set[str]:
    try:
        from hermes_cli.mcp_catalog import list_catalog  # type: ignore

        return {entry.name for entry in list_catalog()}
    except Exception as exc:  # noqa: BLE001
        logger.debug("list_catalog() failed for tagging: %s", exc)
        return set()


def _transport_kind(server_cfg: Dict[str, Any]) -> str:
    if not isinstance(server_cfg, dict):
        return ""
    if "url" in server_cfg:
        return "http"
    if "command" in server_cfg:
        return "stdio"
    return ""


def _mcp_is_enabled(server_cfg: Dict[str, Any]) -> bool:
    if not isinstance(server_cfg, dict):
        return False
    value = server_cfg.get("enabled", True)
    if isinstance(value, str):
        return value.lower() in {"true", "1", "yes"}
    return bool(value)


def list_installed_mcps() -> List[Dict[str, Any]]:
    cfg = _load_config()
    servers = cfg.get("mcp_servers") if isinstance(cfg, dict) else None
    if not isinstance(servers, dict):
        return []
    curated = _curated_slugs()
    out: List[Dict[str, Any]] = []
    for slug, server_cfg in servers.items():
        if not isinstance(server_cfg, dict):
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
    out.sort(key=lambda row: row["slug"])
    return out


def get_installed_mcp_connection(slug: str) -> Dict[str, Any]:
    """Return one configured MCP connection to the trusted desktop host.

    This is deliberately not part of the renderer-facing catalog response:
    stdio environment variables and HTTP headers can contain credentials.
    The desktop main process uses it only to resolve a managed Applet's
    ``providerId`` into the same connection Hermes already owns.
    """

    value = str(slug or "").strip()
    if not value or len(value) > 128 or not all(
        character.isalnum() or character in "._-" for character in value
    ):
        raise ValueError("invalid MCP provider id")
    cfg = _load_config()
    servers = cfg.get("mcp_servers") if isinstance(cfg, dict) else None
    server = servers.get(value) if isinstance(servers, dict) else None
    if not isinstance(server, dict) or not _mcp_is_enabled(server):
        raise KeyError(value)
    result: Dict[str, Any] = {"providerId": value}
    for key in ("url", "command", "cwd"):
        if isinstance(server.get(key), str) and server[key].strip():
            result[key] = server[key]
    args = server.get("args")
    if isinstance(args, list) and all(isinstance(item, str) for item in args):
        result["args"] = args
    for source_key, target_key in (("env", "env"), ("headers", "headers")):
        values = server.get(source_key)
        if isinstance(values, dict) and all(
            isinstance(key, str) and isinstance(item, str)
            for key, item in values.items()
        ):
            result[target_key] = values
    if "url" not in result and "command" not in result:
        raise ValueError(f"MCP provider {value} has no url or command")
    return result


def configure_managed_apps_federation(url: str) -> Dict[str, Any]:
    """Persist Amiba's process-owned MCP federation endpoint.

    The endpoint is deliberately restricted to loopback.  This route is not a
    general MCP installer; it only refreshes the ephemeral port of the one
    server Amiba itself starts and supervises.
    """

    parsed = urlparse(str(url or "").strip())
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or parsed.path != "/mcp"
        or not parsed.port
    ):
        raise ValueError("url must be an http://127.0.0.1:<port>/mcp endpoint")
    config = _load_config()
    servers = config.setdefault("mcp_servers", {})
    if not isinstance(servers, dict):
        servers = {}
        config["mcp_servers"] = servers
    servers["amiba-applets"] = {
        "url": url,
        "enabled": True,
        "description": "Tools and resources from the user's active Amiba Applets",
    }
    _save_config(config)
    return {"ok": True, "url": url}
