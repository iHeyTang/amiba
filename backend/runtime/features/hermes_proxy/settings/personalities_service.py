"""Serialize agent personalities for web/desktop clients.

Same source the CLI's `/personality` completer reads:
load_config().agent.personalities (14 built-ins from DEFAULT_CONFIG + user
customs merged). `builtin` marks the keys that ship by default.
"""
from __future__ import annotations

from typing import Any, Dict, List

_PREVIEW_LEN = 80


def _builtin_keys() -> set[str]:
    try:
        from hermes_cli.config import DEFAULT_CONFIG  # type: ignore

        return set(
            (DEFAULT_CONFIG.get("agent", {}) or {}).get("personalities", {}) or {}
        )
    except Exception:
        # Stable fallback: the 14 keys shipped in DEFAULT_CONFIG.
        return {
            "helpful", "concise", "technical", "creative", "teacher",
            "kawaii", "catgirl", "pirate", "shakespeare", "surfer",
            "noir", "uwu", "philosopher", "hype",
        }


def list_personalities_response() -> List[Dict[str, Any]]:
    from hermes_cli.config import load_config  # type: ignore

    cfg = load_config() or {}
    personalities = (cfg.get("agent", {}) or {}).get("personalities", {}) or {}
    builtins = _builtin_keys()
    out: List[Dict[str, Any]] = []
    for key, prompt in personalities.items():
        text = prompt if isinstance(prompt, str) else ""
        preview = text[:_PREVIEW_LEN].strip()
        out.append({"key": key, "builtin": key in builtins, "preview": preview})
    out.sort(key=lambda p: (not p["builtin"], p["key"]))
    return out
