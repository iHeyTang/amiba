"""Read/write the user's STT config + provider credentials.

Two stores back this:

  * ``~/.hermes/config.yaml`` — non-secret prefs (``stt.enabled``,
    ``stt.provider``, per-provider model names). Read via
    :func:`hermes_cli.config.read_raw_config` so env-ref templates
    survive a round-trip, and written via
    :func:`hermes_cli.config.save_config` which atomically rewrites
    the file in place and invalidates the cache on next read.
  * ``~/.hermes/.env`` — provider API keys
    (``GROQ_API_KEY``, ``OPENAI_API_KEY``, ``MISTRAL_API_KEY``,
    ``ELEVENLABS_API_KEY``). Written via
    :func:`runtime.adapters.dotenv_local.merge_dotenv_file_and_apply`
    which also updates ``os.environ`` so the running gateway sees
    new keys without a restart.

The HTTP layer is thin (see ``routes.py``); this module owns merge
semantics, the credential allow-list, and the read response shape.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from ....adapters.dotenv_local import (
    get_dotenv_values_for_keys,
    merge_dotenv_file_and_apply,
)


# Env-var allow-list per provider. We restrict writes to known STT keys
# so a bad UI request can't accidentally clobber unrelated secrets in
# ``.env``. The keys overlap with the model-providers' env vars by
# design — they're the same physical secret, set once.
CREDENTIAL_KEYS: Dict[str, Tuple[str, ...]] = {
    "groq": ("GROQ_API_KEY",),
    "openai": ("OPENAI_API_KEY", "VOICE_TOOLS_OPENAI_KEY"),
    "mistral": ("MISTRAL_API_KEY",),
    "elevenlabs": ("ELEVENLABS_API_KEY",),
}

VALID_PROVIDERS = frozenset({"local", "groq", "openai", "mistral", "elevenlabs"})

# Model field names per provider section in stt.* (matches what
# transcription_tools reads).
_MODEL_FIELD: Dict[str, str] = {
    "local": "model",
    "groq": "model",
    "openai": "model",
    "mistral": "model",
    "elevenlabs": "model_id",
}


def all_credential_keys() -> List[str]:
    """Flat allow-list across providers. Used for ``has_key`` summaries."""
    seen: list[str] = []
    for keys in CREDENTIAL_KEYS.values():
        for k in keys:
            if k not in seen:
                seen.append(k)
    return seen


def _load_stt_section() -> Dict[str, Any]:
    """Return the raw ``stt.*`` section (or an empty dict if missing)."""
    try:
        from hermes_cli.config import read_raw_config  # type: ignore
    except Exception:
        return {}
    raw = read_raw_config() or {}
    section = raw.get("stt")
    return section if isinstance(section, dict) else {}


def read_config_response() -> Dict[str, Any]:
    """Build the GET /hermes/stt/config response.

    Shape::

        {
          "enabled":     bool,
          "provider":    "local" | "groq" | ... | null,
          "providers": {
            "local":      {"model": "base"},
            "groq":       {"model": "whisper-large-v3-turbo"},
            "openai":     {"model": "whisper-1"},
            "mistral":    {"model": "voxtral-mini-latest"},
            "elevenlabs": {"model_id": "scribe_v2"}
          },
          "credentials": {
            "groq":       {"has_key": bool, "env_var": "GROQ_API_KEY"},
            "openai":     {"has_key": bool, "env_var": "OPENAI_API_KEY"},
            ...
          }
        }

    Values for API keys are deliberately never returned — only their
    presence as a boolean. The renderer treats the input as
    write-only (typed-into form clears the "has_key" indicator).
    """
    section = _load_stt_section()

    enabled = section.get("enabled", True)
    if not isinstance(enabled, bool):
        enabled = True

    provider = section.get("provider")
    if not isinstance(provider, str) or provider.strip() == "":
        provider = None
    else:
        provider = provider.strip().lower()
        if provider not in VALID_PROVIDERS:
            provider = None

    providers: Dict[str, Dict[str, Any]] = {}
    for name in ("local", "groq", "openai", "mistral", "elevenlabs"):
        sub = section.get(name)
        model_field = _MODEL_FIELD[name]
        sub_dict = sub if isinstance(sub, dict) else {}
        model_value = sub_dict.get(model_field)
        providers[name] = {
            model_field: model_value if isinstance(model_value, str) else None,
        }

    # has_key summary per provider — read on-disk .env (with os.environ
    # as a fall-through for already-injected values, matching how
    # get_dotenv_values_for_keys works).
    cred_state: Dict[str, Dict[str, Any]] = {}
    flat = all_credential_keys()
    values = get_dotenv_values_for_keys(flat)
    for provider_name, keys in CREDENTIAL_KEYS.items():
        has = any(bool((values.get(k) or "").strip()) for k in keys)
        cred_state[provider_name] = {
            "has_key": has,
            "env_var": keys[0],
        }

    return {
        "enabled": enabled,
        "provider": provider,
        "providers": providers,
        "credentials": cred_state,
    }


def update_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-merge *patch* into ``stt.*`` and save.

    Accepts the same shape as the read response (minus ``credentials``):
    a partial dict where any subset of ``enabled``, ``provider``,
    ``providers.<name>.<model_field>`` can be set. Unknown keys are
    rejected with a ``ValueError`` so a typo can't silently land
    in config.yaml.
    """
    try:
        from hermes_cli.config import (  # type: ignore
            read_raw_config,
            save_config,
        )
    except Exception as exc:
        raise RuntimeError(f"hermes_cli.config unavailable: {exc}") from exc

    raw = dict(read_raw_config() or {})
    section = raw.get("stt")
    section = dict(section) if isinstance(section, dict) else {}

    if "enabled" in patch:
        val = patch["enabled"]
        if not isinstance(val, bool):
            raise ValueError("'enabled' must be a boolean")
        section["enabled"] = val

    if "provider" in patch:
        val = patch["provider"]
        if val is None:
            section.pop("provider", None)
        elif isinstance(val, str) and val.strip().lower() in VALID_PROVIDERS:
            section["provider"] = val.strip().lower()
        else:
            raise ValueError(
                f"'provider' must be one of {sorted(VALID_PROVIDERS)} or null"
            )

    providers_patch = patch.get("providers")
    if providers_patch is not None:
        if not isinstance(providers_patch, dict):
            raise ValueError("'providers' must be an object")
        for name, sub in providers_patch.items():
            if name not in _MODEL_FIELD:
                raise ValueError(f"unknown provider section '{name}'")
            if not isinstance(sub, dict):
                raise ValueError(f"'providers.{name}' must be an object")
            existing = section.get(name)
            merged = dict(existing) if isinstance(existing, dict) else {}
            model_field = _MODEL_FIELD[name]
            if model_field in sub:
                v = sub[model_field]
                if v is None or v == "":
                    merged.pop(model_field, None)
                elif isinstance(v, str):
                    merged[model_field] = v
                else:
                    raise ValueError(
                        f"'providers.{name}.{model_field}' must be a string"
                    )
            section[name] = merged

    unknown = set(patch.keys()) - {"enabled", "provider", "providers"}
    if unknown:
        raise ValueError(f"unknown fields: {sorted(unknown)}")

    raw["stt"] = section
    save_config(raw)
    return read_config_response()


def update_credentials(provider: str, values: Dict[str, Any]) -> Dict[str, Any]:
    """Merge a provider's API keys into ``~/.hermes/.env``.

    Only keys in ``CREDENTIAL_KEYS[provider]`` are written; unknown
    keys raise ``ValueError`` so a UI bug can't accidentally clobber
    unrelated env vars. Empty-string values delete the key (matches
    ``merge_dotenv_file_and_apply`` semantics).
    """
    provider = (provider or "").strip().lower()
    if provider not in CREDENTIAL_KEYS:
        raise ValueError(f"unknown provider '{provider}'")
    if not isinstance(values, dict):
        raise ValueError("'values' must be an object")
    allowed = set(CREDENTIAL_KEYS[provider])
    unknown = [k for k in values if k not in allowed]
    if unknown:
        raise ValueError(
            f"keys not allowed for {provider}: {sorted(unknown)}"
        )

    updates: Dict[str, str] = {}
    for k, v in values.items():
        if v is None:
            updates[k] = ""
        elif isinstance(v, str):
            updates[k] = v
        else:
            raise ValueError(f"'{k}' must be a string or null")

    merge_dotenv_file_and_apply(updates)
    return read_config_response()
