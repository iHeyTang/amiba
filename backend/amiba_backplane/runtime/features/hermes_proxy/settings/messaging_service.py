"""Direct messaging-channel, pairing, and webhook administration."""

from __future__ import annotations

import re
import secrets
import time
from typing import Any, Dict, List

from ....adapters.dotenv_local import (
    get_dotenv_values_for_keys,
    merge_dotenv_file_and_apply,
)


FALLBACK_PLATFORMS: Dict[str, Dict[str, Any]] = {
    "telegram": {
        "name": "Telegram",
        "required": ["TELEGRAM_BOT_TOKEN"],
        "fields": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"],
    },
    "slack": {
        "name": "Slack",
        "required": ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
        "fields": ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_ALLOWED_USERS"],
    },
    "discord": {
        "name": "Discord",
        "required": ["DISCORD_BOT_TOKEN"],
        "fields": ["DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_USERS"],
    },
    "whatsapp": {
        "name": "WhatsApp",
        "required": ["WHATSAPP_ENABLED"],
        "fields": ["WHATSAPP_ENABLED", "WHATSAPP_MODE", "WHATSAPP_ALLOWED_USERS"],
    },
    "signal": {
        "name": "Signal",
        "required": ["SIGNAL_HTTP_URL", "SIGNAL_ACCOUNT"],
        "fields": ["SIGNAL_HTTP_URL", "SIGNAL_ACCOUNT", "SIGNAL_ALLOWED_USERS"],
    },
    "matrix": {
        "name": "Matrix",
        "required": ["MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN"],
        "fields": ["MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN", "MATRIX_PASSWORD"],
    },
    "email": {
        "name": "Email",
        "required": ["EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_SMTP_HOST"],
        "fields": ["EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST"],
    },
    "sms": {
        "name": "SMS",
        "required": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
        "fields": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    },
    "webhook": {
        "name": "Webhook",
        "required": [],
        "fields": ["WEBHOOK_ENABLED", "WEBHOOK_PORT", "WEBHOOK_SECRET"],
    },
}

PLATFORM_ORDER = (
    "telegram",
    "discord",
    "slack",
    "mattermost",
    "matrix",
    "whatsapp",
    "signal",
    "email",
    "sms",
    "dingtalk",
    "feishu",
    "google_chat",
    "teams",
    "webhook",
)

PLATFORM_PREFIXES = {
    "email": ("EMAIL_",),
    "homeassistant": ("HASS_",),
    "qqbot": ("QQ_", "QQBOT_"),
    "sms": ("TWILIO_", "SMS_"),
    "wecom": ("WECOM_BOT_", "WECOM_SECRET"),
    "wecom_callback": ("WECOM_CALLBACK_",),
}


def _env_name(entry: Any) -> str:
    if isinstance(entry, str):
        return entry.strip()
    if isinstance(entry, dict):
        return str(entry.get("name") or "").strip()
    return ""


def _platform_catalog() -> Dict[str, Dict[str, Any]]:
    """Build the channel catalog from the bundled Hermes runtime.

    The fallback keeps the settings surface usable in isolated unit tests or
    during a partial runtime recovery. In normal Desktop operation the Platform
    enum, plugin registry, and config metadata are the source of truth, so a
    newly bundled or user-installed platform appears without an Amiba release.
    """
    try:
        from gateway.config import Platform  # type: ignore
        from gateway.platform_registry import platform_registry  # type: ignore
        from hermes_cli.config import OPTIONAL_ENV_VARS  # type: ignore
        from hermes_cli.plugins import discover_plugins  # type: ignore

        discover_plugins()
        plugin_entries = {entry.name: entry for entry in platform_registry.plugin_entries()}
        platform_ids: List[str] = []
        for member in Platform.__members__.values():
            value = str(member.value)
            if value != "local" and value not in platform_ids:
                platform_ids.append(value)
        for value in plugin_entries:
            if value not in platform_ids:
                platform_ids.append(value)
        if "webhook" not in platform_ids:
            platform_ids.append("webhook")

        catalog: Dict[str, Dict[str, Any]] = {}
        for platform_id in platform_ids:
            plugin = plugin_entries.get(platform_id)
            fallback = FALLBACK_PLATFORMS.get(platform_id, {})
            required = [
                name
                for name in (_env_name(item) for item in getattr(plugin, "required_env", []))
                if name
            ] or list(fallback.get("required", []))
            prefixes = PLATFORM_PREFIXES.get(
                platform_id,
                (f"{platform_id.upper().replace('-', '_')}_",),
            )
            discovered = [
                key
                for key, info in OPTIONAL_ENV_VARS.items()
                if isinstance(info, dict)
                and info.get("category") == "messaging"
                and any(key.startswith(prefix) for prefix in prefixes)
            ]
            fields = list(dict.fromkeys([*required, *fallback.get("fields", []), *discovered]))
            catalog[platform_id] = {
                "name": (
                    getattr(plugin, "label", "")
                    or fallback.get("name")
                    or platform_id.replace("_", " ").title()
                ),
                "required": required,
                "fields": fields,
                "field_meta": {
                    key: OPTIONAL_ENV_VARS.get(key, {}) for key in fields
                },
            }
        order = {name: index for index, name in enumerate(PLATFORM_ORDER)}
        return dict(
            sorted(
                catalog.items(),
                key=lambda item: (
                    order.get(item[0], len(PLATFORM_ORDER)),
                    str(item[1]["name"]).lower(),
                ),
            )
        )
    except Exception:
        return FALLBACK_PLATFORMS


def _config() -> Dict[str, Any]:
    from hermes_cli.config import load_config  # type: ignore

    value = load_config()
    return value if isinstance(value, dict) else {}


def list_platforms(runtime_platforms: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    cfg = _config()
    catalog = _platform_catalog()
    configured_platforms = cfg.get("platforms")
    if not isinstance(configured_platforms, dict):
        configured_platforms = {}
    runtime_platforms = runtime_platforms if isinstance(runtime_platforms, dict) else {}
    result: List[Dict[str, Any]] = []
    for platform_id, meta in catalog.items():
        saved = get_dotenv_values_for_keys(meta["fields"])
        platform_config = configured_platforms.get(platform_id)
        if not isinstance(platform_config, dict):
            platform_config = {}
        required = list(meta["required"])
        configured = all(str(saved.get(key) or "").strip() for key in required)
        enabled = bool(platform_config.get("enabled", False))
        runtime = runtime_platforms.get(platform_id)
        runtime = runtime if isinstance(runtime, dict) else {}
        state = str(runtime.get("state") or ("disabled" if not enabled else "not_configured" if not configured else "pending_restart"))
        result.append({
            "id": platform_id,
            "name": meta["name"],
            "enabled": enabled,
            "configured": configured,
            "state": state,
            "error": str(runtime.get("error_message") or ""),
            "fields": [
                {
                    "key": key,
                    "required": key in required,
                    "configured": bool(str(saved.get(key) or "").strip()),
                    "label": str(meta.get("field_meta", {}).get(key, {}).get("prompt") or key),
                    "description": str(meta.get("field_meta", {}).get(key, {}).get("description") or ""),
                    "secret": bool(meta.get("field_meta", {}).get(key, {}).get("password", False)),
                }
                for key in meta["fields"]
            ],
        })
    return result


def save_platform(platform_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    meta = _platform_catalog().get(platform_id)
    if meta is None:
        raise KeyError(platform_id)
    allowed = set(meta["fields"])
    raw_values = payload.get("env")
    raw_values = raw_values if isinstance(raw_values, dict) else {}
    updates: Dict[str, str] = {}
    for key, value in raw_values.items():
        if key not in allowed:
            raise ValueError(f"{key} is not configurable for {meta['name']}")
        if not isinstance(value, str):
            raise ValueError(f"{key} must be a string")
        updates[key] = value.strip()
    if updates:
        merge_dotenv_file_and_apply(updates)
    if isinstance(payload.get("enabled"), bool):
        from hermes_cli.config import write_platform_config_field  # type: ignore

        write_platform_config_field(platform_id, "enabled", payload["enabled"])
    return {"ok": True, "platform": platform_id}


def _pairing_store():
    from gateway.pairing import PairingStore  # type: ignore

    return PairingStore()


def list_pairings() -> Dict[str, Any]:
    store = _pairing_store()
    return {"ok": True, "pending": store.list_pending(), "approved": store.list_approved()}


def approve_pairing(platform: str, target: str) -> Dict[str, Any]:
    store = _pairing_store()
    value = str(target or "").strip()
    result = store.approve_request(platform, value) if store.looks_like_request_id(value) else store.approve_code(platform, value.upper())
    if not result:
        raise KeyError(value)
    return {"ok": True, "user": result}


def revoke_pairing(platform: str, user_id: str) -> Dict[str, Any]:
    if not _pairing_store().revoke(platform, user_id):
        raise KeyError(user_id)
    return {"ok": True}


def list_webhooks() -> Dict[str, Any]:
    import hermes_cli.webhook as webhook  # type: ignore

    base_url = webhook._get_webhook_base_url()
    subscriptions = webhook._load_subscriptions()
    return {
        "ok": True,
        "enabled": webhook._is_webhook_enabled(),
        "base_url": base_url,
        "subscriptions": [
            {
                "name": name,
                "description": route.get("description", ""),
                "events": list(route.get("events") or []),
                "deliver": route.get("deliver", "log"),
                "enabled": route.get("enabled", True) is not False,
                "url": f"{base_url}/webhooks/{name}",
                "secret_set": bool(route.get("secret")),
            }
            for name, route in subscriptions.items()
        ],
    }


def create_webhook(payload: Dict[str, Any]) -> Dict[str, Any]:
    import hermes_cli.webhook as webhook  # type: ignore

    name = str(payload.get("name") or "").strip().lower().replace(" ", "-")
    if not re.match(r"^[a-z0-9][a-z0-9_-]*$", name):
        raise ValueError("invalid webhook name")
    secret = str(payload.get("secret") or "").strip() or secrets.token_urlsafe(32)
    route = {
        "description": str(payload.get("description") or ""),
        "events": [str(item).strip() for item in payload.get("events", []) if str(item).strip()],
        "deliver": str(payload.get("deliver") or "log"),
        "prompt": str(payload.get("prompt") or ""),
        "skills": [str(item).strip() for item in payload.get("skills", []) if str(item).strip()],
        "secret": secret,
        "enabled": True,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    subscriptions = webhook._load_subscriptions()
    subscriptions[name] = route
    webhook._save_subscriptions(subscriptions)
    return {"ok": True, "name": name, "secret": secret, "url": f"{webhook._get_webhook_base_url()}/webhooks/{name}"}


def mutate_webhook(
    name: str,
    *,
    updates: Dict[str, Any] | None = None,
    remove: bool = False,
) -> Dict[str, Any]:
    import hermes_cli.webhook as webhook  # type: ignore

    key = str(name or "").strip().lower()
    subscriptions = webhook._load_subscriptions()
    if key not in subscriptions:
        raise KeyError(key)
    if remove:
        del subscriptions[key]
    else:
        updates = updates if isinstance(updates, dict) else {}
        route = subscriptions[key]
        if "enabled" in updates:
            if not isinstance(updates["enabled"], bool):
                raise ValueError("enabled must be a boolean")
            route["enabled"] = updates["enabled"]
        for field in ("description", "deliver", "prompt"):
            if field in updates:
                if not isinstance(updates[field], str):
                    raise ValueError(f"{field} must be a string")
                route[field] = updates[field].strip()
        for field in ("events", "skills"):
            if field in updates:
                if not isinstance(updates[field], list):
                    raise ValueError(f"{field} must be a list")
                route[field] = [
                    str(item).strip() for item in updates[field] if str(item).strip()
                ]
        if "secret" in updates:
            if not isinstance(updates["secret"], str):
                raise ValueError("secret must be a string")
            if updates["secret"].strip():
                route["secret"] = updates["secret"].strip()
        route["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    webhook._save_subscriptions(subscriptions)
    return {"ok": True, "name": key}
