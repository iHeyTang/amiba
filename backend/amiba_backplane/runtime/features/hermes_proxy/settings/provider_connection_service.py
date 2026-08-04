"""Normalize provider credentials into a secret-free connection model.

Hermes providers authenticate in materially different ways: an API key may be
used directly, Anthropic can borrow Claude Code OAuth, and Copilot first finds
a GitHub identity token before exchanging it for a service token. The UI
should not reimplement those rules. This module turns provider-specific
signals into one stable vocabulary.
"""

from __future__ import annotations

import hashlib
import os
import time
from typing import Any, Dict, Iterable, List, Optional

from ....adapters.hermes_core import inspect_provider_auth_sources

_MACHINE_SCOPED_AUTH_TYPES = frozenset(
    {
        "aws_sdk",
        "copilot",
        "external_process",
        "oauth_external",
    }
)
_SERVICE_VERIFICATION_TTL_SECONDS = 5 * 60
_service_verification_cache: Dict[
    str,
    tuple[float, Dict[str, str]],
] = {}


def allows_ambient_credentials(auth_type: str, profile_id: str) -> bool:
    """Whether process-level credentials can belong to this Profile runtime.

    Root API-key environment variables are the default Profile's private
    credentials. Named Profiles only share authentication mechanisms Hermes
    itself treats as machine-scoped (for example an external CLI login).
    """

    return (
        str(profile_id or "").strip().lower() in {"", "default"}
        or str(auth_type or "").strip() in _MACHINE_SCOPED_AUTH_TYPES
    )


def _verification_cache_key(
    provider: str,
    active_method: Optional[Dict[str, Any]],
    *,
    saved_values: Dict[str, str],
    runtime_values: Dict[str, str],
) -> str:
    """Fingerprint the credential source without retaining any secret."""

    digest = hashlib.sha256()
    digest.update(str(provider or "").encode())
    digest.update(str((active_method or {}).get("id") or "").encode())
    for key in sorted(set(saved_values) | set(runtime_values)):
        value = saved_values.get(key) or runtime_values.get(key) or ""
        if not value:
            continue
        digest.update(key.encode())
        digest.update(b"\0")
        digest.update(str(value).encode())
        digest.update(b"\0")
    return digest.hexdigest()


def _remember_service_verification(
    cache_key: str,
    service: Dict[str, Any],
) -> None:
    status = str(service.get("status") or "")
    if status not in {"verified", "unavailable"}:
        return
    _service_verification_cache[cache_key] = (
        time.monotonic() + _SERVICE_VERIFICATION_TTL_SECONDS,
        {
            "status": status,
            "reason": str(service.get("reason") or ""),
        },
    )


def _read_service_verification(cache_key: str) -> Optional[Dict[str, str]]:
    cached = _service_verification_cache.get(cache_key)
    if not cached:
        return None
    expires_at, service = cached
    if expires_at <= time.monotonic():
        _service_verification_cache.pop(cache_key, None)
        return None
    return dict(service)


def _has_value(value: Any) -> bool:
    return bool(str(value or "").strip())


def _method_kind(field_key: str) -> str:
    key = str(field_key or "").upper()
    if "OAUTH" in key or key.endswith("_TOKEN"):
        return "oauth_token"
    return "api_key"


def _env_method(
    *,
    key: str,
    saved_values: Dict[str, str],
    runtime_values: Dict[str, str],
) -> Dict[str, Any]:
    saved = _has_value(saved_values.get(key))
    runtime = _has_value(runtime_values.get(key))
    return {
        "id": f"env:{key}",
        "kind": _method_kind(key),
        "source": "saved" if saved else ("environment" if runtime else "none"),
        "field_key": key,
        "configured": saved,
        "detected": saved or runtime,
        "editable": True,
        "status": "configured" if saved else ("detected" if runtime else "none"),
        "scope": "profile" if saved else ("system" if runtime else "none"),
    }


def _external_method(
    method_id: str,
    *,
    kind: str = "external_cli",
) -> Dict[str, Any]:
    return {
        "id": f"external:{method_id}",
        "kind": kind,
        "source": method_id,
        "field_key": "",
        "configured": False,
        "detected": True,
        "editable": False,
        "status": "detected",
        "scope": "system",
    }


def _pool_method(entry: Dict[str, Any]) -> Dict[str, Any]:
    source = str(entry.get("source") or "").strip()
    auth_type = str(entry.get("auth_type") or "").strip()
    entry_id = str(entry.get("id") or source).strip()
    borrowed = source.startswith("env:") or source in {
        "claude_code",
        "gh_cli",
        "github_cli",
        "hermes_pkce",
    }
    return {
        "id": f"pool:{entry_id}",
        "kind": "oauth" if auth_type == "oauth" else "api_key",
        "source": source,
        "field_key": "",
        "configured": not borrowed,
        "detected": True,
        "editable": False,
        "status": "detected" if borrowed else "configured",
        "label": str(entry.get("label") or "").strip(),
        "priority": int(entry.get("priority", 0) or 0),
        "scope": str(entry.get("scope") or "profile").strip(),
    }


def _first_method(
    methods: Iterable[Dict[str, Any]],
    ids: Iterable[str],
) -> Optional[Dict[str, Any]]:
    by_id = {str(method.get("id") or ""): method for method in methods}
    for method_id in ids:
        method = by_id.get(method_id)
        if method and method.get("detected"):
            return method
    return None


def _anthropic_active_method(
    methods: List[Dict[str, Any]],
    *,
    runtime_source: str,
    saved_values: Dict[str, str],
    runtime_values: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    if runtime_source:
        upstream = _first_method(methods, [runtime_source])
        if upstream:
            return upstream

    manual = next(
        (
            method
            for method in methods
            if str(method.get("id") or "").startswith("pool:manual")
            and method.get("detected")
        ),
        None,
    )
    if manual:
        return manual

    api_key = _has_value(
        saved_values.get("ANTHROPIC_API_KEY")
        or runtime_values.get("ANTHROPIC_API_KEY")
    )
    oauth_env = _has_value(
        saved_values.get("ANTHROPIC_TOKEN")
        or runtime_values.get("ANTHROPIC_TOKEN")
        or saved_values.get("CLAUDE_CODE_OAUTH_TOKEN")
        or runtime_values.get("CLAUDE_CODE_OAUTH_TOKEN")
    )

    # Hermes treats an API key with no OAuth env vars as an explicit choice
    # and suppresses auto-discovered Claude Code / Hermes PKCE credentials.
    if api_key and not oauth_env:
        return _first_method(methods, ["env:ANTHROPIC_API_KEY"])

    return _first_method(
        methods,
        [
            "env:ANTHROPIC_TOKEN",
            "env:CLAUDE_CODE_OAUTH_TOKEN",
            "external:hermes_pkce",
            "external:claude_code",
            "env:ANTHROPIC_API_KEY",
        ],
    )


def _copilot_active_method(
    methods: List[Dict[str, Any]],
    runtime_source: str,
) -> Optional[Dict[str, Any]]:
    if runtime_source.startswith(("env:", "external:", "pool:")):
        return _first_method(methods, [runtime_source])
    source_to_id = {
        "COPILOT_GITHUB_TOKEN": "env:COPILOT_GITHUB_TOKEN",
        "GH_TOKEN": "env:GH_TOKEN",
        "GITHUB_TOKEN": "env:GITHUB_TOKEN",
        "gh auth token": "external:github_cli",
    }
    explicit = source_to_id.get(runtime_source)
    if explicit:
        selected = _first_method(methods, [explicit])
        if selected:
            return selected
    return None


def build_provider_connection(
    provider: str,
    *,
    auth_type: str,
    secret_keys: List[str],
    saved_values: Dict[str, str],
    verify_service: bool,
    allow_ambient_env: bool = True,
) -> Dict[str, Any]:
    """Build the normalized, secret-free connection payload for one provider."""

    slug = str(provider or "").strip().lower()
    runtime_values = {
        key: str(os.environ.get(key, "") or "") if allow_ambient_env else ""
        for key in secret_keys
    }
    snapshot = inspect_provider_auth_sources(
        slug,
        verify_service=verify_service,
    )

    methods = [
        _env_method(
            key=key,
            saved_values=saved_values,
            runtime_values=runtime_values,
        )
        for key in secret_keys
    ]

    external_sources = snapshot.get("external_sources")
    if isinstance(external_sources, list):
        for raw_source in external_sources:
            source = str(raw_source or "").strip()
            if source and not any(
                method.get("id") == f"external:{source}" for method in methods
            ):
                methods.append(_external_method(source))

    pool_sources = snapshot.get("pool_sources")
    if isinstance(pool_sources, list):
        env_pool_sources = {f"env:{key}" for key in secret_keys}
        external_pool_sources = {
            "claude_code": "claude_code",
            "gh_cli": "github_cli",
            "github_cli": "github_cli",
            "hermes_pkce": "hermes_pkce",
        }
        for raw_entry in pool_sources:
            if not isinstance(raw_entry, dict):
                continue
            source = str(raw_entry.get("source") or "").strip()
            if not source or source in env_pool_sources:
                continue
            external_source = external_pool_sources.get(source)
            if external_source:
                if not any(
                    method.get("id") == f"external:{external_source}"
                    for method in methods
                ):
                    methods.append(_external_method(external_source))
                continue
            methods.append(_pool_method(raw_entry))

    runtime_source = str(snapshot.get("runtime_source") or "").strip()
    if slug == "anthropic":
        active = _anthropic_active_method(
            methods,
            runtime_source=runtime_source,
            saved_values=saved_values,
            runtime_values=runtime_values,
        )
    elif slug == "copilot":
        active = _copilot_active_method(methods, runtime_source)
    else:
        active = next(
            (method for method in methods if method.get("detected")),
            None,
        )

    allow_generic_runtime = (
        str(auth_type or "").strip()
        not in {"", "api_key"}
        or runtime_source.startswith(("external:", "pool:"))
    )
    if (
        active is None
        and snapshot.get("runtime_logged_in")
        and allow_generic_runtime
    ):
        generic_id = runtime_source or str(auth_type or "external").strip()
        if generic_id:
            generic = _external_method(generic_id, kind="external")
            if runtime_source.startswith("pool:"):
                generic["scope"] = "shared"
            methods.append(generic)
            active = generic

    if active is not None:
        active["status"] = "active"

    service = snapshot.get("service")
    if not isinstance(service, dict):
        service = {"status": "not_checked", "reason": ""}
    verification_cache_key = _verification_cache_key(
        slug,
        active,
        saved_values=saved_values,
        runtime_values=runtime_values,
    )
    if verify_service:
        _remember_service_verification(verification_cache_key, service)
    elif str(service.get("status") or "") == "not_checked":
        service = _read_service_verification(verification_cache_key) or service
    service_status = str(service.get("status") or "not_checked")

    if service_status == "verified":
        status = "verified"
    elif service_status == "unavailable":
        status = "unavailable"
    elif slug == "copilot" and active:
        # A GitHub identity token proves identity, not Copilot entitlement.
        # Until Hermes successfully exchanges it for a Copilot service token,
        # the provider must stay out of executable model lists.
        status = "verification_required"
    elif active and active.get("configured"):
        status = "configured"
    elif active or (
        snapshot.get("runtime_logged_in")
        and allow_generic_runtime
    ):
        status = "detected"
    else:
        status = "none"

    return {
        "status": status,
        "active_method": str(active.get("id") or "") if active else "",
        "active_scope": str(active.get("scope") or "none") if active else "none",
        "methods": methods,
        "service": {
            "status": service_status,
            "reason": str(service.get("reason") or ""),
        },
    }
