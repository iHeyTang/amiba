"""
Single integration point with the Hermes core Python package.

All upstream symbol lookups, optional-import fallbacks, and HERMES_HOME
resolution live here. Other adapters MUST go through this module instead
of importing ``hermes_constants`` / ``hermes_cli`` / ``providers`` directly,
so that upstream changes only require edits in one place.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("my-browser-bridge")

_FALLBACK_HERMES_HOME = Path.home() / ".hermes"
_ACTIVE_PROFILE_ID: ContextVar[str] = ContextVar(
    "amiba_active_hermes_profile_id",
    default="default",
)


def hermes_home() -> Path:
    """Resolve the Hermes HOME directory.

    Prefers ``hermes_constants.get_hermes_home`` when the core package is
    importable; otherwise falls back to ``~/.hermes``.
    """
    try:
        from hermes_constants import get_hermes_home  # type: ignore

        return Path(get_hermes_home())
    except Exception:
        return _FALLBACK_HERMES_HOME


def normalize_profile_id(profile: str | None) -> str:
    value = str(profile or "").strip().lower()
    return value or "default"


def current_profile_id() -> str:
    """Return the profile selected by the current backplane request."""
    return _ACTIVE_PROFILE_ID.get()


def is_default_profile() -> bool:
    return current_profile_id() == "default"


def profile_home(profile: str | None) -> Path:
    """Resolve a validated Hermes profile home without duplicating its layout."""
    normalized = normalize_profile_id(profile)
    if normalized == "default":
        try:
            from hermes_constants import get_default_hermes_root  # type: ignore

            return Path(get_default_hermes_root())
        except Exception:
            return _FALLBACK_HERMES_HOME
    try:
        from hermes_cli.profiles import (  # type: ignore
            get_profile_dir,
            profile_exists,
            validate_profile_name,
        )

        validate_profile_name(normalized)
        if not profile_exists(normalized):
            raise FileNotFoundError(f"Profile '{normalized}' does not exist")
        return Path(get_profile_dir(normalized))
    except FileNotFoundError:
        raise
    except Exception as exc:
        raise ValueError(f"Invalid Hermes profile '{normalized}': {exc}") from exc


@contextmanager
def hermes_profile_scope(profile: str | None):
    """Scope file/config/SessionDB operations to one Hermes profile.

    This is the backplane's single profile-scoping seam. It intentionally does
    not mutate ``os.environ``; concurrent HTTP requests can safely target
    different profiles.
    """
    normalized = normalize_profile_id(profile)
    profile_token = _ACTIVE_PROFILE_ID.set(normalized)
    try:
        from hermes_constants import (  # type: ignore
            reset_hermes_home_override,
            set_hermes_home_override,
        )
    except Exception:
        # Lightweight adapter tests and development shells can run the
        # backplane without Hermes installed. Downstream services retain
        # their existing fallback/error behavior in that environment.
        try:
            yield normalized
        finally:
            _ACTIVE_PROFILE_ID.reset(profile_token)
        return

    token = set_hermes_home_override(profile_home(normalized))
    try:
        yield normalized
    finally:
        reset_hermes_home_override(token)
        _ACTIVE_PROFILE_ID.reset(profile_token)


@lru_cache(maxsize=1)
def hermes_cli_models_available() -> bool:
    """Whether the ``hermes_cli.models`` module is importable in this process."""
    try:
        import hermes_cli.models  # type: ignore  # noqa: F401

        return True
    except Exception:
        return False


def load_hermes_config() -> Dict[str, Any]:
    """Load the active Hermes profile config through the upstream API."""
    try:
        from hermes_cli.config import load_config  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"hermes_cli.config unavailable: {exc}") from exc
    config = load_config()
    return config if isinstance(config, dict) else {}


def save_hermes_config(config: Dict[str, Any]) -> None:
    """Persist the active Hermes profile config through the upstream API."""
    try:
        from hermes_cli.config import save_config  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"hermes_cli.config unavailable: {exc}") from exc
    save_config(config)


def normalize_moa_config(raw: Any) -> Dict[str, Any]:
    """Normalize MoA configuration with Hermes's own schema and defaults."""
    try:
        from hermes_cli.moa_config import normalize_moa_config as _normalize  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"hermes_cli.moa_config unavailable: {exc}") from exc
    normalized = _normalize(raw)
    return normalized if isinstance(normalized, dict) else {}


def validate_moa_config(raw: Any) -> List[str]:
    """Validate a MoA write with Hermes's strict write-boundary contract."""
    try:
        from hermes_cli.moa_config import validate_moa_payload as _validate  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"hermes_cli.moa_config unavailable: {exc}") from exc
    problems = _validate(raw)
    if not isinstance(problems, list):
        return ["Hermes returned an invalid MoA validation result"]
    return [str(problem) for problem in problems if str(problem).strip()]


def load_canonical_providers() -> Optional[List[Dict[str, Any]]]:
    """Return canonical provider rows ``[{slug, label, tui_desc}, ...]``.

    Returns ``None`` when the upstream package is unavailable.
    """
    try:
        from hermes_cli.models import CANONICAL_PROVIDERS  # type: ignore
    except Exception:
        return None

    out: List[Dict[str, Any]] = []
    try:
        for p in CANONICAL_PROVIDERS:
            slug = str(getattr(p, "slug", "") or "").strip()
            if not slug:
                continue
            label = str(getattr(p, "label", "") or slug)
            out.append(
                {
                    "slug": slug,
                    "label": label,
                    "tui_desc": str(getattr(p, "tui_desc", "") or label),
                }
            )
    except Exception:
        return None
    return out


def normalize_provider(raw: str) -> str:
    """Normalize a provider slug via Hermes CLI; return ``raw`` on failure."""
    try:
        from hermes_cli.models import normalize_provider as _normalize  # type: ignore

        return _normalize(raw)
    except Exception:
        return raw


def curated_models_for_provider(
    normalized: str, *, force_refresh: bool = False
) -> List[Tuple[str, str]]:
    """Return curated ``(id, description)`` tuples; empty list on failure."""
    try:
        from hermes_cli.models import curated_models_for_provider as _curated  # type: ignore

        return list(_curated(normalized, force_refresh=force_refresh))
    except Exception as exc:
        logger.info("hermes_cli curated_models(%r) failed: %s", normalized, exc)
        return []


def get_pricing_for_provider(
    normalized: str, *, force_refresh: bool = False
) -> Dict[str, Dict[str, str]]:
    """Return live pricing map for the provider; empty dict on failure."""
    try:
        from hermes_cli.models import get_pricing_for_provider as _pricing  # type: ignore

        return _pricing(normalized, force_refresh=force_refresh)
    except Exception as exc:
        logger.info("hermes_cli pricing(%r) failed: %s", normalized, exc)
        return {}


def get_provider_profile(slug: str) -> Optional[Any]:
    """Return the upstream ``ProviderProfile`` for ``slug``, or ``None``.

    Wraps ``providers.get_provider_profile`` so callers don't need to handle
    the optional import themselves.
    """
    try:
        from providers import get_provider_profile as _get  # type: ignore

        return _get(slug)
    except Exception:
        return None


def _provider_credential_pool(
    provider: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return a public pool summary plus the private entries used to verify it.

    ``auth.json`` entries can contain bearer and refresh tokens. This helper is
    the single redaction boundary: only source metadata leaves this adapter;
    the raw entries remain local to ``inspect_provider_auth_sources``.
    """

    try:
        from hermes_cli.auth import read_credential_pool  # type: ignore

        raw_entries = read_credential_pool(provider)
    except Exception:
        return [], []
    if not isinstance(raw_entries, list):
        return [], []

    pool_scope = _credential_pool_scope(provider)
    public_entries: List[Dict[str, Any]] = []
    private_entries: List[Dict[str, Any]] = []
    for position, entry in enumerate(raw_entries):
        if not isinstance(entry, dict):
            continue
        source = str(entry.get("source") or "").strip()
        entry_id = str(entry.get("id") or source or position).strip()
        if not source:
            continue
        try:
            priority = int(entry.get("priority", position))
        except (TypeError, ValueError):
            priority = position
        public_entries.append(
            {
                "id": entry_id,
                "source": source,
                "auth_type": str(entry.get("auth_type") or "").strip(),
                "label": str(entry.get("label") or "").strip(),
                "priority": priority,
                "scope": pool_scope,
            }
        )
        private_entries.append(entry)
    return public_entries, private_entries


def _auth_store_has_provider_pool(path: Path, provider: str) -> bool:
    """Check pool ownership without returning or logging credential values."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    pool = payload.get("credential_pool") if isinstance(payload, dict) else None
    entries = pool.get(provider) if isinstance(pool, dict) else None
    return isinstance(entries, list) and bool(entries)


def _credential_pool_scope(provider: str) -> str:
    """Identify whether Hermes read this provider pool locally or via fallback."""
    active_home = hermes_home()
    if _auth_store_has_provider_pool(active_home / "auth.json", provider):
        return "profile"
    if is_default_profile():
        return "profile"
    try:
        from hermes_constants import get_default_hermes_root  # type: ignore

        default_home = Path(get_default_hermes_root())
    except Exception:
        default_home = _FALLBACK_HERMES_HOME
    if _auth_store_has_provider_pool(default_home / "auth.json", provider):
        return "shared"
    return "none"


def _pool_method_id(entry: Dict[str, Any]) -> str:
    """Map an upstream pool entry to the normalized method identifier."""

    source = str(entry.get("source") or "").strip()
    if source.startswith("env:"):
        return source
    if source in {"claude_code", "hermes_pkce", "github_cli", "gh_cli"}:
        return f"external:{'github_cli' if source == 'gh_cli' else source}"
    entry_id = str(entry.get("id") or source).strip()
    return f"pool:{entry_id}" if entry_id else ""


def inspect_provider_auth_sources(
    slug: str,
    *,
    verify_service: bool = False,
) -> Dict[str, Any]:
    """Return a secret-free snapshot of Hermes credential discovery.

    This is the only adapter that knows about Hermes's provider-specific auth
    modules. Callers receive stable source identifiers and verification
    states, never access tokens or refresh tokens.

    ``verify_service`` is opt-in because Copilot verification exchanges the
    detected GitHub credential for a short-lived Copilot token over the
    network. That token stays inside Hermes and is discarded before return.
    """

    provider = str(slug or "").strip().lower()
    snapshot: Dict[str, Any] = {
        "runtime_logged_in": False,
        "runtime_source": "",
        "external_sources": [],
        "pool_sources": [],
        "service": {"status": "not_applicable", "reason": ""},
    }
    if not provider:
        return snapshot

    public_pool, private_pool = _provider_credential_pool(provider)
    snapshot["pool_sources"] = public_pool

    if provider == "anthropic":
        try:
            from agent.anthropic_adapter import (  # type: ignore
                read_claude_code_credentials,
                read_hermes_oauth_credentials,
            )

            claude_code = read_claude_code_credentials() or {}
            if str(claude_code.get("accessToken") or "").strip():
                snapshot["external_sources"].append("claude_code")

            hermes_oauth = read_hermes_oauth_credentials() or {}
            if str(hermes_oauth.get("accessToken") or "").strip():
                snapshot["external_sources"].append("hermes_pkce")
        except Exception:
            pass

        snapshot["runtime_logged_in"] = bool(
            snapshot["external_sources"] or snapshot["pool_sources"]
        )
        if public_pool:
            snapshot["runtime_source"] = _pool_method_id(
                min(
                    public_pool,
                    key=lambda entry: int(entry.get("priority", 0)),
                )
            )
        snapshot["service"] = {"status": "not_checked", "reason": ""}
        return snapshot

    if provider == "copilot":
        snapshot["service"] = {"status": "not_checked", "reason": ""}
        try:
            from hermes_cli.copilot_auth import (  # type: ignore
                exchange_copilot_token,
                resolve_copilot_token,
                validate_copilot_token,
            )

            try:
                raw_token, source = resolve_copilot_token()
            except ValueError:
                raw_token, source = "", ""
                snapshot["service"] = {
                    "status": "unavailable",
                    "reason": "unsupported_token",
                }
            raw_token = str(raw_token or "").strip()
            source = str(source or "").strip()
            candidates: List[Tuple[str, str]] = []
            if raw_token:
                candidates.append((source, raw_token))
                if source == "gh auth token":
                    snapshot["external_sources"].append("github_cli")
            else:
                for public_entry, private_entry in zip(
                    public_pool,
                    private_pool,
                ):
                    pool_token = str(
                        private_entry.get("access_token") or ""
                    ).strip()
                    valid, _message = validate_copilot_token(pool_token)
                    if valid:
                        candidates.append(
                            (_pool_method_id(public_entry), pool_token)
                        )

            if not candidates:
                return snapshot

            snapshot["runtime_logged_in"] = True
            snapshot["runtime_source"] = candidates[0][0]
            if not verify_service:
                return snapshot

            last_error = ""
            for candidate_source, candidate_token in candidates:
                try:
                    result = exchange_copilot_token(
                        candidate_token,
                        timeout=6.0,
                    )
                    exchanged = result[0] if isinstance(result, tuple) else ""
                    if exchanged:
                        snapshot["runtime_source"] = candidate_source
                        snapshot["service"] = {
                            "status": "verified",
                            "reason": "",
                        }
                        return snapshot
                    last_error = "empty_exchange"
                except Exception as exc:
                    last_error = str(exc).lower()

            denied = any(
                marker in last_error
                for marker in (
                    "bad credentials",
                    "http error 400",
                    "http error 401",
                    "http error 403",
                    "http error 404",
                    "http error 422",
                    "unauthorized",
                    "forbidden",
                )
            )
            snapshot["service"] = {
                "status": "unavailable" if denied else "not_checked",
                "reason": (
                    "copilot_access_denied"
                    if denied
                    else (
                        "empty_exchange"
                        if last_error == "empty_exchange"
                        else "verification_failed"
                    )
                ),
            }
        except Exception:
            pass
        return snapshot

    try:
        from hermes_cli.auth import get_auth_status  # type: ignore

        status = get_auth_status(provider)
        if isinstance(status, dict):
            snapshot["runtime_logged_in"] = bool(
                status.get("logged_in") or status.get("configured")
            )
            snapshot["runtime_source"] = str(
                status.get("key_source") or status.get("source") or ""
            ).strip()
    except Exception:
        pass
    snapshot["service"] = {"status": "not_checked", "reason": ""}
    return snapshot
