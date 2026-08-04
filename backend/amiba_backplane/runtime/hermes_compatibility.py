"""Hermes Agent version contract enforced by the Amiba backplane."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple

from aiohttp import web

from .common import json_error

MINIMUM_HERMES_VERSION = "0.19.0"

_VERSION_RE = re.compile(
    r"(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)([A-Za-z+-][0-9A-Za-z.-]*)?"
)
_COMPATIBILITY_EXEMPT_PATHS = frozenset(
    {
        "/health",
        "/hermes/status",
        "/hermes/update",
    }
)


def parse_hermes_version(value: object) -> Optional[Tuple[int, int, int, bool, str]]:
    if not isinstance(value, str):
        return None
    match = _VERSION_RE.search(value.strip())
    if match is None:
        return None
    major, minor, patch = (int(match.group(i)) for i in range(1, 4))
    suffix = match.group(4) or ""
    prerelease = bool(suffix and not suffix.startswith("+"))
    normalized = f"{major}.{minor}.{patch}{suffix}"
    return major, minor, patch, prerelease, normalized


def version_is_supported(
    installed: object,
    required: str = MINIMUM_HERMES_VERSION,
) -> bool:
    current = parse_hermes_version(installed)
    minimum = parse_hermes_version(required)
    if current is None or minimum is None:
        return False
    current_release = current[:3]
    minimum_release = minimum[:3]
    if current_release != minimum_release:
        return current_release > minimum_release
    if current[3] != minimum[3]:
        return not current[3]
    return True


@lru_cache(maxsize=1)
def installed_hermes_version() -> str:
    try:
        from hermes_cli import __version__  # type: ignore
    except Exception:
        return ""
    return str(__version__ or "").strip()


def hermes_compatibility_status() -> Dict[str, Any]:
    installed = installed_hermes_version()
    parsed = parse_hermes_version(installed)
    compatible = version_is_supported(installed)
    return {
        "hermes_version": parsed[4] if parsed is not None else installed,
        "minimum_hermes_version": MINIMUM_HERMES_VERSION,
        "hermes_version_compatible": compatible,
        "hermes_version_error": (
            None
            if compatible
            else "unverifiable"
            if parsed is None
            else "unsupported"
        ),
    }


def _is_exempt(request: web.Request) -> bool:
    return (
        request.method == "OPTIONS"
        or request.path in _COMPATIBILITY_EXEMPT_PATHS
        or request.path.startswith("/hermes/actions/")
    )


@web.middleware
async def hermes_compatibility_middleware(request: web.Request, handler):
    if _is_exempt(request):
        return await handler(request)

    status = hermes_compatibility_status()
    if status["hermes_version_compatible"]:
        return await handler(request)

    installed = status["hermes_version"] or "unknown"
    required = status["minimum_hermes_version"]
    response = json_error(
        426,
        f"Hermes {installed} is not supported; Amiba requires Hermes {required} or newer",
    )
    response.headers["X-Amiba-Error-Code"] = "hermes_version_unsupported"
    response.headers["X-Hermes-Version"] = installed
    response.headers["X-Minimum-Hermes-Version"] = required
    return response
