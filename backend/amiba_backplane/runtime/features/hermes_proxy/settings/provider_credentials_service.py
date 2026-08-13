"""Per-provider credential schema — what env vars to render + their current values.

Provider profiles declare authentication fields via
``ProviderProfile.env_vars``. Endpoint defaults and override variables come
from ``hermes_cli.auth.PROVIDER_REGISTRY`` — the same registry Hermes uses at
request time — and are returned as one resolved endpoint object.

Providers with a non-env authentication path return an ``auth_hint`` even
when editable env credentials also exist. This lets clients present external
login and token-based methods without flattening them into one form.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from ....adapters.dotenv_local import (
    is_valid_env_key,
    merge_dotenv_file_and_apply,
    plugin_dotenv_path,
    read_dotenv_as_dict,
)
from ....adapters.hermes_core import (
    current_profile_id,
    get_provider_profile,
    is_default_profile,
)
from ....adapters.hermes_provider_env import (
    base_url_env_var_for_slug,
    env_var_names_for_slug,
    provider_endpoint_definition_for_slug,
)
from .provider_connection_service import (
    allows_ambient_credentials,
    build_provider_connection,
)

# Matches the extension's custom-provider UX: any of these env vars is
# accepted as the bearer token for a user-supplied OpenAI-compatible
# endpoint.
_CUSTOM_PROVIDER_ENV_KEYS = (
    "CUSTOM_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
)


def _field_kind(key: str) -> str:
    """Coarse field-kind hint for the UI.

    - ``url``: the key looks URL-shaped (``*_BASE_URL`` / ``*_URL``)
    - ``secret``: everything else (rendered as a password / API-key input)
    """
    up = key.upper()
    if up.endswith("_BASE_URL") or up.endswith("_URL"):
        return "url"
    return "secret"


def _field_placeholder(key: str, default_base_url: str) -> str:
    if _field_kind(key) == "url":
        return default_base_url
    return ""


def _resolve_provider_endpoint(
    slug: str,
    *,
    saved_values: Dict[str, str],
    allow_ambient_env: bool,
) -> Dict[str, str]:
    """Resolve the exact provider endpoint chain exposed to the desktop.

    The definition and precedence mirror Hermes runtime resolution for a
    canonical API-key provider: provider-specific saved override, ambient
    override (default Profile only), then the registry default.  The generic
    ``model.base_url`` is intentionally absent: Amiba reserves that setting
    for the explicit ``custom`` provider and clears it for canonical writes.
    """
    definition = provider_endpoint_definition_for_slug(slug)
    default_base_url = definition["default_base_url"]
    override_env_var = definition["override_env_var"]
    saved_override = (
        str(saved_values.get(override_env_var, "") or "").strip()
        if override_env_var
        else ""
    )
    ambient_override = (
        str(os.environ.get(override_env_var, "") or "").strip()
        if override_env_var and allow_ambient_env
        else ""
    )
    override_base_url = saved_override or ambient_override
    effective_base_url = override_base_url or default_base_url
    if saved_override:
        source = "saved"
    elif ambient_override:
        source = "environment"
    elif default_base_url:
        source = "default"
    else:
        source = "none"
    return {
        "default_base_url": default_base_url,
        "override_env_var": override_env_var,
        "override_base_url": override_base_url,
        "effective_base_url": effective_base_url,
        "source": source,
    }


def allowed_credential_keys_for_provider(slug: str) -> List[str]:
    """Env var allow-list for read/write — all writable vars for the slug.

    Composes plugin-declared API key env vars with the canonical URL
    override env var (``DEEPSEEK_BASE_URL``, ``OPENAI_BASE_URL``, …) when
    one exists. The URL var lives in ``hermes_cli.auth.PROVIDER_REGISTRY``
    and is rarely mirrored in the plugin's ``env_vars`` tuple, so we
    merge here to give the credentials panel a complete view.
    """
    s = str(slug or "").strip()
    if not s or s == "auto":
        return []
    if s == "custom":
        return list(_CUSTOM_PROVIDER_ENV_KEYS)
    keys: List[str] = list(env_var_names_for_slug(s))
    seen = set(keys)
    url_env = base_url_env_var_for_slug(s)
    if url_env and url_env not in seen:
        keys.append(url_env)
    return keys


# Plain-language hint per auth_type, shown when the provider has no
# env-editable fields. Empty string means "show nothing".
_AUTH_HINT_BY_TYPE = {
    "oauth_device_code": "Sign in with `hermes auth login {slug}`.",
    "oauth_external": (
        "Authenticate via the external CLI (Claude Code / Codex / Qwen / etc.)."
    ),
    "external_process": "Started and authenticated by an external process.",
    "aws_sdk": "Uses AWS SDK credentials from `~/.aws` or the IAM environment.",
    "copilot": "Uses your GitHub Copilot subscription.",
}


def _auth_hint_for(slug: str) -> str:
    """Short hint shown when a provider has nothing to fill in here."""
    prof = get_provider_profile(slug)
    if prof is None:
        return ""
    auth_type = getattr(prof, "auth_type", "api_key")
    tmpl = _AUTH_HINT_BY_TYPE.get(auth_type, "")
    return tmpl.format(slug=slug) if tmpl else ""


def read_provider_credentials_response(
    provider: str,
    *,
    verify_service: bool = False,
) -> Dict[str, Any]:
    raw = str(provider or "").strip()
    if not raw:
        raise ValueError("missing provider query parameter")
    keys = allowed_credential_keys_for_provider(raw)
    prof = get_provider_profile(raw)
    auth_type = str(getattr(prof, "auth_type", "") or "").strip()
    allow_ambient_env = allows_ambient_credentials(
        auth_type,
        current_profile_id(),
    )
    saved_values = read_dotenv_as_dict(plugin_dotenv_path())
    endpoint = _resolve_provider_endpoint(
        raw,
        saved_values=saved_values,
        allow_ambient_env=allow_ambient_env,
    )
    if not keys:
        return {
            "ok": True,
            "provider": raw,
            "fields": [],
            "auth_hint": _auth_hint_for(raw),
            "auth_type": auth_type,
            "connection": build_provider_connection(
                raw,
                auth_type=auth_type,
                secret_keys=[],
                saved_values={},
                verify_service=verify_service,
                allow_ambient_env=allow_ambient_env,
            ),
            "endpoint": endpoint,
            "profile": current_profile_id(),
        }
    fields: List[Dict[str, Any]] = []
    for k in keys:
        saved_value = saved_values.get(k, "")
        ambient_value = (
            str(os.environ.get(k, "") or "") if allow_ambient_env else ""
        )
        kind = _field_kind(k)
        origin = (
            "saved"
            if saved_value.strip()
            else ("environment" if ambient_value.strip() else "none")
        )
        fields.append(
            {
                "key": k,
                # This endpoint is the local desktop settings boundary. Return
                # values the process can already read so the renderer can show
                # them in a masked password field instead of substituting a
                # misleading "stored" placeholder. External credential-pool
                # entries remain metadata-only because Hermes does not expose
                # their underlying tokens here.
                "value": saved_value or ambient_value,
                "placeholder": _field_placeholder(
                    k, endpoint["default_base_url"]
                ),
                "kind": kind,
                "origin": origin,
                "configured": bool(saved_value.strip() or ambient_value.strip()),
            }
        )
    secret_keys = [field["key"] for field in fields if field["kind"] == "secret"]
    return {
        "ok": True,
        "provider": raw,
        "fields": fields,
        "auth_hint": _auth_hint_for(raw),
        "auth_type": auth_type,
        "connection": build_provider_connection(
            raw,
            auth_type=auth_type,
            secret_keys=secret_keys,
            saved_values=saved_values,
            verify_service=verify_service,
            allow_ambient_env=allow_ambient_env,
        ),
        "endpoint": endpoint,
        "profile": current_profile_id(),
    }


def merge_credentials_for_provider(provider: str, values: Dict[str, Any]) -> List[str]:
    """Merge *values* into the plugin ``.env`` for *provider*'s allowed keys only.

    No-op (returns ``[]``) when *provider* is empty, ``auto``, or has no
    registered credential keys. Unknown keys in *values* are ignored
    (defence against UI bugs sending wrong keys to wrong providers).
    """
    raw = str(provider or "").strip()
    if not raw or raw == "auto":
        return []
    allowed = allowed_credential_keys_for_provider(raw)
    if not allowed:
        return []
    allowed_set = set(allowed)
    updates: Dict[str, str] = {}
    for key, value in values.items():
        if not isinstance(key, str) or key not in allowed_set:
            continue
        if not is_valid_env_key(key):
            continue
        if value is not None and not isinstance(value, str):
            raise ValueError(f"value for {key!r} must be string")
        updates[key] = str(value) if value is not None else ""

    merge_dotenv_file_and_apply(
        updates,
        apply_process=is_default_profile(),
    )
    return sorted(updates.keys())
