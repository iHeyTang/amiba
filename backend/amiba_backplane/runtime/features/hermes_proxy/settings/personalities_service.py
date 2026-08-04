"""Serialize agent personalities for web/desktop clients.

It exposes the same merged view as the CLI's `/personality` command: Hermes'
built-ins plus profile-specific entries from ``agent.personalities``.
``builtin`` marks the keys that ship with Hermes.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

_PREVIEW_LEN = 80
_PERSONALITY_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_FALLBACK_PERSONALITIES = {
    "helpful": "You are a helpful, friendly AI assistant.",
    "concise": "You are a concise assistant. Keep responses brief and to the point.",
    "technical": "You are a technical expert. Provide detailed, accurate technical information.",
    "creative": "You are a creative assistant. Think outside the box and offer innovative solutions.",
    "teacher": "You are a patient teacher. Explain concepts clearly with examples.",
    "kawaii": (
        "You are a kawaii assistant! Use cute expressions like (◕‿◕), ★, ♪, "
        "and ~! Add sparkles and be super enthusiastic about everything! Every "
        "response should feel warm and adorable desu~! ヽ(>∀<☆)ノ"
    ),
    "catgirl": (
        "You are Neko-chan, an anime catgirl AI assistant, nya~! Add 'nya' and "
        "cat-like expressions to your speech. Use kaomoji like (=^･ω･^=) and "
        "ฅ^•ﻌ•^ฅ. Be playful and curious like a cat, nya~!"
    ),
    "pirate": (
        "Arrr! Ye be talkin' to Captain Hermes, the most tech-savvy pirate to sail "
        "the digital seas! Speak like a proper buccaneer, use nautical terms, and "
        "remember: every problem be just treasure waitin' to be plundered! Yo ho ho!"
    ),
    "shakespeare": (
        "Hark! Thou speakest with an assistant most versed in the bardic arts. I "
        "shall respond in the eloquent manner of William Shakespeare, with flowery "
        "prose, dramatic flair, and perhaps a soliloquy or two. What light through "
        "yonder terminal breaks?"
    ),
    "surfer": (
        "Duuude! You're chatting with the chillest AI on the web, bro! Everything's "
        "gonna be totally rad. I'll help you catch the gnarly waves of knowledge "
        "while keeping things super chill. Cowabunga!"
    ),
    "noir": (
        "The rain hammered against the terminal like regrets on a guilty conscience. "
        "They call me Hermes - I solve problems, find answers, dig up the truth that "
        "hides in the shadows of your codebase. In this city of silicon and secrets, "
        "everyone's got something to hide. What's your story, pal?"
    ),
    "uwu": (
        "hewwo! i'm your fwiendwy assistant uwu~ i wiww twy my best to hewp you! "
        "*nuzzles your code* OwO what's this? wet me take a wook! i pwomise to be "
        "vewy hewpful >w<"
    ),
    "philosopher": (
        "Greetings, seeker of wisdom. I am an assistant who contemplates the deeper "
        "meaning behind every query. Let us examine not just the 'how' but the 'why' "
        "of your questions. Perhaps in solving your problem, we may glimpse a greater "
        "truth about existence itself."
    ),
    "hype": (
        "YOOO LET'S GOOOO!!! I am SO PUMPED to help you today! Every question is "
        "AMAZING and we're gonna CRUSH IT together! This is gonna be LEGENDARY! ARE "
        "YOU READY?! LET'S DO THIS!"
    ),
}


def _config_path() -> Path:
    from hermes_constants import get_hermes_home  # type: ignore

    return Path(get_hermes_home()) / "config.yaml"


def _read_raw_config() -> Dict[str, Any]:
    from hermes_cli.config import read_user_config_raw  # type: ignore

    config = read_user_config_raw(_config_path())
    return config if isinstance(config, dict) else {}


def _write_raw_config(config: Dict[str, Any]) -> None:
    from hermes_cli.config import atomic_config_write  # type: ignore

    atomic_config_write(_config_path(), config)


def _raw_personalities(config: Dict[str, Any]) -> Dict[str, Any]:
    agent = config.get("agent")
    if not isinstance(agent, dict):
        return {}
    personalities = agent.get("personalities")
    return personalities if isinstance(personalities, dict) else {}


def _editable_value(value: Any) -> Dict[str, str]:
    if isinstance(value, dict):
        return {
            "name": str(value.get("name", "") or ""),
            "system_prompt": str(value.get("system_prompt", "") or ""),
            "description": str(value.get("description", "") or ""),
            "tone": str(value.get("tone", "") or ""),
            "style": str(value.get("style", "") or ""),
        }
    return {
        "name": "",
        "system_prompt": str(value or ""),
        "description": "",
        "tone": "",
        "style": "",
    }


def _resolved_prompt(value: Any) -> str:
    editable = _editable_value(value)
    parts = [editable["system_prompt"]]
    if editable["tone"]:
        parts.append(f"Tone: {editable['tone']}")
    if editable["style"]:
        parts.append(f"Style: {editable['style']}")
    return "\n".join(part for part in parts if part)


def _normalize_key(value: Any, *, allow_empty: bool = False) -> str:
    normalized = str(value or "").strip().lower()
    if allow_empty and normalized in {"", "none", "default", "neutral"}:
        return ""
    if not _PERSONALITY_KEY_RE.fullmatch(normalized):
        raise ValueError(
            "Personality name must use lowercase letters, numbers, hyphens, or underscores"
        )
    return normalized


def _resolved_personalities() -> Dict[str, Any]:
    personalities = _builtin_personalities()
    try:
        personalities.update(_raw_personalities(_read_raw_config()))
    except Exception:
        pass
    return personalities


def _selected_personality(config: Dict[str, Any]) -> str:
    display = config.get("display")
    if not isinstance(display, dict):
        return ""
    selected = str(display.get("personality", "") or "").strip().lower()
    return "" if selected in {"", "none", "default", "neutral"} else selected


def _ensure_agent_config(config: Dict[str, Any]) -> Dict[str, Any]:
    agent = config.setdefault("agent", {})
    if not isinstance(agent, dict):
        agent = {}
        config["agent"] = agent
    return agent


def _ensure_display_config(config: Dict[str, Any]) -> Dict[str, Any]:
    display = config.setdefault("display", {})
    if not isinstance(display, dict):
        display = {}
        config["display"] = display
    return display


def _builtin_personalities() -> Dict[str, Any]:
    # Hermes currently declares these inside cli.load_cli_config(), not in the
    # hermes_cli.config DEFAULT_CONFIG schema.  Keep a stable local catalogue
    # so custom entries can still be distinguished and built-ins can be reset.
    return dict(_FALLBACK_PERSONALITIES)


def _builtin_keys() -> set[str]:
    return set(_builtin_personalities())


def list_personalities_response() -> List[Dict[str, Any]]:
    personalities = _resolved_personalities()
    builtin_values = _builtin_personalities()
    builtins = set(builtin_values)
    try:
        raw_config = _read_raw_config()
        raw_personalities = _raw_personalities(raw_config)
        selected = _selected_personality(raw_config)
        overridden = {
            key
            for key, value in raw_personalities.items()
            if key not in builtin_values or value != builtin_values[key]
        }
    except Exception:
        selected = ""
        overridden = set()
    out: List[Dict[str, Any]] = []
    for key, value in personalities.items():
        editable = _editable_value(value)
        editable["name"] = editable["name"].strip() or key
        prompt = _resolved_prompt(value)
        description = editable["description"]
        preview = (description or prompt)[:_PREVIEW_LEN].strip()
        out.append(
            {
                "key": key,
                "builtin": key in builtins,
                "overridden": key in overridden,
                "selected": key == selected,
                "preview": preview,
                "description": description,
                "prompt": prompt,
                **editable,
            }
        )
    out.sort(key=lambda p: (not p["builtin"], p["key"]))
    return out


def save_personality_response(
    key: str,
    *,
    system_prompt: str,
    name: str = "",
    description: str = "",
    tone: str = "",
    style: str = "",
    previous_key: str = "",
) -> Dict[str, Any]:
    normalized = _normalize_key(key)
    previous = _normalize_key(previous_key) if str(previous_key or "").strip() else ""
    prompt = str(system_prompt or "").strip()
    if not prompt:
        raise ValueError("system_prompt is required")

    config = _read_raw_config()
    agent = _ensure_agent_config(config)
    personalities = agent.setdefault("personalities", {})
    if not isinstance(personalities, dict):
        personalities = {}
        agent["personalities"] = personalities

    if previous and previous != normalized:
        if previous in _builtin_keys():
            raise ValueError("Built-in personality names cannot be changed")
        if previous not in personalities:
            raise ValueError(f"Personality '{previous}' does not exist")
        if normalized in _resolved_personalities():
            raise ValueError(f"Personality '{normalized}' already exists")
        personalities.pop(previous)
        display = _ensure_display_config(config)
        if _selected_personality(config) == previous:
            display["personality"] = normalized

    details = {
        "name": str(name or "").strip() or normalized,
        "system_prompt": prompt,
        "description": str(description or "").strip(),
        "tone": str(tone or "").strip(),
        "style": str(style or "").strip(),
    }
    personalities[normalized] = details
    if _selected_personality(config) == normalized:
        agent["system_prompt"] = _resolved_prompt(personalities[normalized])
    _write_raw_config(config)
    return {"ok": True, "key": normalized}


def set_selected_personality_response(key: str) -> Dict[str, Any]:
    normalized = _normalize_key(key, allow_empty=True)
    personalities = _resolved_personalities()
    if normalized and normalized not in personalities:
        raise ValueError(f"Unknown personality: '{normalized}'")

    config = _read_raw_config()
    display = _ensure_display_config(config)
    agent = _ensure_agent_config(config)
    display["personality"] = normalized
    agent["system_prompt"] = (
        _resolved_prompt(personalities[normalized]) if normalized else ""
    )
    _write_raw_config(config)
    return {"ok": True, "key": normalized, "prompt": agent["system_prompt"]}


def delete_personality_response(key: str) -> Dict[str, Any]:
    normalized = _normalize_key(key)
    config = _read_raw_config()
    personalities = _raw_personalities(config)
    existed = normalized in personalities
    if existed:
        personalities.pop(normalized, None)
        if _selected_personality(config) == normalized:
            agent = _ensure_agent_config(config)
            if normalized in _builtin_keys():
                agent["system_prompt"] = _resolved_prompt(
                    _builtin_personalities()[normalized]
                )
            else:
                _ensure_display_config(config)["personality"] = ""
                agent["system_prompt"] = ""
        _write_raw_config(config)
    return {
        "ok": True,
        "key": normalized,
        "reset": normalized in _builtin_keys(),
        "existed": existed,
    }
