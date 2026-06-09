"""Integration discovery, load, and the in-process capability registry.

**Single source:** directories under ``~/.hermes/integrations/<name>/``. Each
directory is imported as a free-standing package named
``hermes_integration_<name>`` (so relative imports inside it resolve), and we
grab its **capabilities** — currently a module-level ``search`` callable — plus
its ``integration.yaml`` metadata.

This package is **HTTP-agnostic**. An integration is plain domain logic +
a manifest + (optionally) a resolver skill; it never touches aiohttp or knows
it will be served over HTTP. The ``http-backplane`` plugin reads this registry
in-process and adapts the capabilities into a web API for the composer.

Public surface (what the backplane reads):
- :func:`list_loaded` / :func:`get` — loaded integrations + their ``search``.
- :func:`mention_resources` — flattened ``mention_resources`` registry.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# search(rtype: str, query: str, limit: int) -> {"ok": bool, "items": [...]}
SearchFn = Callable[..., Awaitable[Dict[str, Any]]]

_HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
USER_INTEGRATIONS_DIR = _HERMES_HOME / "integrations"


@dataclass
class LoadedIntegration:
    """An integration that imported cleanly.

    ``search`` is the integration's typeahead capability (or None if it
    declares none). ``meta`` is the parsed ``integration.yaml``.
    """

    name: str
    path: Path
    meta: Dict[str, Any] = field(default_factory=dict)
    search: Optional[SearchFn] = None


@dataclass
class LoadResult:
    loaded: List[LoadedIntegration] = field(default_factory=list)
    failed: List[Dict[str, str]] = field(default_factory=list)


_state: LoadResult = LoadResult()


def get_state() -> LoadResult:
    return _state


def list_loaded() -> List[LoadedIntegration]:
    return list(_state.loaded)


def get(name: str) -> Optional[LoadedIntegration]:
    """Loaded integration by name, or None."""
    return next((e for e in _state.loaded if e.name == name), None)


def _read_meta(integration_dir: Path) -> Dict[str, Any]:
    yaml_path = integration_dir / "integration.yaml"
    if not yaml_path.exists():
        return {}
    try:
        import yaml  # pyyaml is a hermes-agent dep
    except ImportError:
        logger.warning("pyyaml not available; skipping %s metadata", yaml_path)
        return {}
    try:
        with yaml_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("failed to parse %s: %s", yaml_path, exc)
        return {}


def _import_integration(integration_dir: Path):
    """Import a user integration directory as a synthetic package.

    Namespaced ``hermes_integration_<name>`` so user integrations can't
    collide in ``sys.modules``; ``submodule_search_locations`` makes
    ``from .lark_cli import ...`` resolve to siblings.
    """
    name = integration_dir.name
    pkg_name = f"hermes_integration_{name}"
    init_path = integration_dir / "__init__.py"
    if not init_path.exists():
        raise FileNotFoundError(
            f"integration {name!r} missing __init__.py at {init_path}"
        )
    for stale in [k for k in sys.modules if k == pkg_name or k.startswith(pkg_name + ".")]:
        del sys.modules[stale]
    spec = importlib.util.spec_from_file_location(
        pkg_name, init_path, submodule_search_locations=[str(integration_dir)]
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build import spec for {init_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[pkg_name] = mod
    spec.loader.exec_module(mod)
    return mod


def _capabilities(mod) -> Dict[str, Any]:
    """Pull the capability callables an integration exposes. Today: search."""
    search = getattr(mod, "search", None)
    return {"search": search if callable(search) else None}


def _discover_user_dirs() -> List[Path]:
    if not USER_INTEGRATIONS_DIR.exists():
        return []
    out: List[Path] = []
    for entry in sorted(USER_INTEGRATIONS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if not (entry / "__init__.py").exists():
            logger.info("skipping %s: no __init__.py", entry)
            continue
        out.append(entry)
    return out


def load_all() -> LoadResult:
    """Discover + import every user integration into the registry."""
    global _state
    result = LoadResult()
    for integration_dir in _discover_user_dirs():
        name = integration_dir.name
        try:
            mod = _import_integration(integration_dir)
        except Exception as exc:
            logger.exception("integration %s failed to import", name)
            result.failed.append({"name": name, "error": str(exc)})
            continue
        caps = _capabilities(mod)
        meta = _read_meta(integration_dir)
        if caps["search"] is None:
            # Imported fine but exposes no capability — almost always a
            # stale/misconfigured integration (e.g. its __init__ forgot to
            # `from .x import search`). It would otherwise sit in the registry
            # silently returning empty results, so make it visible.
            declares_mentions = isinstance(meta.get("mention_resources"), list)
            logger.warning(
                "integration %r loaded but exposes no `search` capability%s — "
                "its @-mentions will return nothing. Check its __init__.py "
                "re-exports `search`.",
                name,
                " (it declares mention_resources)" if declares_mentions else "",
            )
        result.loaded.append(
            LoadedIntegration(
                name=name,
                path=integration_dir,
                meta=meta,
                search=caps["search"],
            )
        )
    _state = result
    logger.info(
        "integrations loaded: %d ok, %d failed", len(result.loaded), len(result.failed)
    )
    return result


def load_one(name: str) -> LoadedIntegration:
    """(Re)load a single integration and swap it into the registry."""
    integration_dir = USER_INTEGRATIONS_DIR / name
    mod = _import_integration(integration_dir)
    entry = LoadedIntegration(
        name=name,
        path=integration_dir,
        meta=_read_meta(integration_dir),
        search=_capabilities(mod)["search"],
    )
    _state.loaded[:] = [e for e in _state.loaded if e.name != name]
    _state.loaded.append(entry)
    return entry


def drop(name: str) -> bool:
    """Remove an integration from the in-process registry."""
    before = len(_state.loaded)
    _state.loaded[:] = [e for e in _state.loaded if e.name != name]
    return len(_state.loaded) != before


def mention_resources() -> List[Dict[str, Any]]:
    """Flatten every loaded integration's ``mention_resources`` declarations.

    The composite ``key`` (``<integration>.<type>``) is what the ``@[key:...]``
    token and the frontend provider registry key on. Tolerant of malformed
    manifests — a bad entry is skipped, never fatal.
    """
    out: List[Dict[str, Any]] = []
    for entry in _state.loaded:
        decls = (entry.meta or {}).get("mention_resources")
        if not isinstance(decls, list):
            continue
        for decl in decls:
            if not isinstance(decl, dict):
                continue
            rtype = decl.get("type")
            if not isinstance(rtype, str) or not rtype:
                continue
            fields = decl.get("fields")
            trigger = decl.get("trigger")
            group = decl.get("group")
            serialize = decl.get("serialize")
            out.append(
                {
                    "key": f"{entry.name}.{rtype}",
                    "integration": entry.name,
                    "type": rtype,
                    "label": decl.get("label") or f"{entry.name}.{rtype}",
                    "icon": decl.get("icon"),
                    "trigger": trigger if trigger in ("@", "/") else "@",
                    "fields": (
                        [f for f in fields if isinstance(f, str)]
                        if isinstance(fields, list)
                        else []
                    ),
                    "serialize": serialize if isinstance(serialize, str) else "",
                    "search": f"/integrations/{entry.name}/search?type={rtype}",
                    "group": group if isinstance(group, str) and group else entry.name,
                }
            )
    return out
