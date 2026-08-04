"""Adapters for Hermes virtual capabilities.

Virtual capabilities are configured through their own domain surface even
though Hermes keeps wire compatibility by exposing them as model providers.
Currently Hermes ships one such capability: Mixture of Agents (``moa``).
"""

from __future__ import annotations

from typing import Any, Dict

from ....adapters.hermes_core import (
    load_hermes_config,
    normalize_moa_config,
    save_hermes_config,
    validate_moa_config,
)


def _moa_response(
    raw: Dict[str, Any],
    *,
    configured: bool,
) -> Dict[str, Any]:
    normalized = normalize_moa_config(raw)
    return {
        "ok": True,
        "configured": configured,
        **normalized,
        # These diagnostics settings intentionally live outside the normalized
        # preset schema. Return them so a capable client can round-trip them,
        # while keeping unknown future keys untouched in storage.
        "save_traces": bool(raw.get("save_traces", False)),
        "trace_dir": str(raw.get("trace_dir") or ""),
    }


def read_moa_config_response() -> Dict[str, Any]:
    config = load_hermes_config()
    raw = config.get("moa")
    moa = raw if isinstance(raw, dict) else {}
    return _moa_response(moa, configured=isinstance(raw, dict))


def write_moa_config_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    presets = payload.get("presets")
    if not isinstance(presets, dict) or not presets:
        raise ValueError("presets must be a non-empty object")

    config = load_hermes_config()
    existing = config.get("moa")
    raw = dict(existing) if isinstance(existing, dict) else {}
    raw.update(
        {
            "default_preset": str(payload.get("default_preset") or "").strip(),
            "active_preset": str(payload.get("active_preset") or "").strip(),
            "presets": presets,
        }
    )
    if "privacy_filter" in payload:
        raw["privacy_filter"] = payload.get("privacy_filter")

    problems = validate_moa_config(raw)
    if problems:
        raise ValueError("Invalid MoA config: " + "; ".join(problems))

    normalized = normalize_moa_config(raw)
    # Hermes owns the normalized preset fields; Amiba preserves diagnostic and
    # future upstream keys it does not understand.
    raw.update(normalized)
    config["moa"] = raw
    save_hermes_config(config)
    return _moa_response(raw, configured=True)
