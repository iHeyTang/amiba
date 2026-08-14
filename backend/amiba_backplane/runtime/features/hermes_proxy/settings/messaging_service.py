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
        "required": [],
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
        "required": [
            "EMAIL_ADDRESS",
            "EMAIL_PASSWORD",
            "EMAIL_IMAP_HOST",
            "EMAIL_SMTP_HOST",
        ],
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
    "mattermost": {
        "name": "Mattermost",
        "required": ["MATTERMOST_URL", "MATTERMOST_TOKEN"],
        "fields": ["MATTERMOST_URL", "MATTERMOST_TOKEN", "MATTERMOST_ALLOWED_USERS"],
    },
    "homeassistant": {
        "name": "Home Assistant",
        "required": ["HASS_URL", "HASS_TOKEN"],
        "fields": ["HASS_URL", "HASS_TOKEN"],
    },
    "dingtalk": {
        "name": "DingTalk",
        "required": ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
        "fields": ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
    },
    "feishu": {
        "name": "Feishu / Lark",
        "required": ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
        "fields": [
            "FEISHU_APP_ID",
            "FEISHU_APP_SECRET",
            "FEISHU_ENCRYPT_KEY",
            "FEISHU_VERIFICATION_TOKEN",
        ],
    },
    "wecom": {
        "name": "WeCom (group bot)",
        "required": ["WECOM_BOT_ID"],
        "fields": ["WECOM_BOT_ID", "WECOM_SECRET"],
    },
    "weixin": {
        "name": "Weixin / WeChat (Personal)",
        "required": ["WEIXIN_ACCOUNT_ID", "WEIXIN_TOKEN"],
        "fields": ["WEIXIN_ACCOUNT_ID", "WEIXIN_TOKEN", "WEIXIN_BASE_URL"],
    },
    "qqbot": {
        "name": "QQ Bot",
        "required": ["QQ_APP_ID", "QQ_CLIENT_SECRET"],
        "fields": ["QQ_APP_ID", "QQ_CLIENT_SECRET", "QQ_ALLOWED_USERS"],
    },
}

# Human-facing context that is not part of the gateway adapter contract. The
# catalog and connection state still come from the bundled Hermes runtime; this
# mapping only gives the settings UI a stable explanation and a setup guide for
# the channels most people encounter first.
PLATFORM_DETAILS: Dict[str, Dict[str, str]] = {
    "telegram": {
        "description": "Chat with Hermes through a Telegram bot.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram",
    },
    "discord": {
        "description": "Use Hermes in Discord servers and direct messages.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/discord",
    },
    "slack": {
        "description": "Connect Hermes to a Slack workspace.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack",
    },
    "whatsapp": {
        "description": "Chat with Hermes from a linked WhatsApp account.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp",
    },
    "signal": {
        "description": "Connect through a self-hosted Signal bridge.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/signal",
    },
    "matrix": {
        "description": "Use Hermes in Matrix rooms and direct messages.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/matrix",
    },
    "email": {
        "description": "Send and receive messages through an email account.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/email",
    },
    "dingtalk": {
        "description": "Use Hermes in DingTalk groups.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/dingtalk",
    },
    "feishu": {
        "description": "Use Hermes inside Feishu or Lark.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu",
    },
    "wecom": {
        "description": "Send Hermes messages to a WeCom group bot.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/wecom",
    },
    "qqbot": {
        "description": "Connect Hermes to a bot from the QQ Open Platform.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/qqbot",
    },
    "webhook": {
        "description": "Receive events from GitHub, GitLab, and other services.",
        "docs_url": "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks",
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

# These are gateway plumbing, not apps a person can choose as a notification
# destination. Webhooks have their own tab on this screen; exposing them again
# as a channel also made Amiba's generated API server key look like a channel
# the user had configured.
INTERNAL_PLATFORM_IDS = {
    "a2a",
    "api_server",
    "local",
    "msgraph_webhook",
    "relay",
    "webhook",
}

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
            if platform_id in INTERNAL_PLATFORM_IDS:
                continue
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
                "description": PLATFORM_DETAILS.get(platform_id, {}).get(
                    "description",
                    str(getattr(plugin, "install_hint", "") or ""),
                ),
                "docs_url": PLATFORM_DETAILS.get(platform_id, {}).get(
                    "docs_url", ""
                ),
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
        return {
            platform_id: {
                **meta,
                **PLATFORM_DETAILS.get(platform_id, {}),
            }
            for platform_id, meta in FALLBACK_PLATFORMS.items()
            if platform_id not in INTERNAL_PLATFORM_IDS
        }


def _config() -> Dict[str, Any]:
    from hermes_cli.config import load_config  # type: ignore

    value = load_config()
    return value if isinstance(value, dict) else {}


def _has_field_value(key: str, value: Any) -> bool:
    normalized = str(value or "").strip()
    if not normalized:
        return False
    if key.upper().endswith("_ENABLED"):
        return normalized.lower() in {"1", "true", "yes", "on"}
    return True


def _platform_configuration(
    platform_id: str,
    required: List[str],
    saved: Dict[str, str],
    runtime: Dict[str, Any] | None = None,
) -> tuple[bool, bool]:
    """Read enablement and whether the user has actually configured a channel.

    Credentials in ``.env`` implicitly enable most Hermes adapters. An
    explicit ``platforms.<id>.enabled`` overrides that default. Runtime state
    is accepted as the strongest signal because it came from the live Gateway.

    Do not call ``load_gateway_config`` here: this function runs once per row,
    and loading the Gateway config performs plugin dependency checks. Besides
    being needlessly expensive, a read-only settings page could otherwise
    trigger optional package installation dozens of times.
    """
    cfg = _config()
    configured_platforms = cfg.get("platforms")
    if not isinstance(configured_platforms, dict):
        configured_platforms = {}
    raw_platform = configured_platforms.get(platform_id)
    if not isinstance(raw_platform, dict):
        raw_platform = {}
    explicit_enabled = raw_platform.get("enabled")

    required_complete = bool(required) and all(
        _has_field_value(key, saved.get(key)) for key in required
    )
    has_saved_settings = any(
        not key.upper().endswith("_ENABLED")
        and _has_field_value(key, value)
        for key, value in saved.items()
    )
    has_platform_settings = any(
        key != "enabled" and value not in (None, "", False, [], {})
        for key, value in raw_platform.items()
    )
    configured = bool(
        required_complete
        or (
            not required
            and (has_saved_settings or has_platform_settings)
        )
    )
    if isinstance(explicit_enabled, bool):
        enabled = explicit_enabled
    elif isinstance(explicit_enabled, str):
        enabled = explicit_enabled.strip().lower() in {"1", "true", "yes", "on"}
    else:
        enabled = configured

    runtime = runtime if isinstance(runtime, dict) else {}
    runtime_state = str(runtime.get("state") or "").strip().lower()
    if runtime_state in {"connected", "connecting", "starting"}:
        enabled = True
        configured = True
    return enabled, configured


def _is_secret_field(key: str, field_meta: Dict[str, Any]) -> bool:
    if bool(field_meta.get("password", False)):
        return True
    upper = key.upper()
    return any(
        marker in upper
        for marker in ("TOKEN", "PASSWORD", "SECRET", "API_KEY", "AES_KEY")
    )


def list_platforms(
    runtime_platforms: Dict[str, Any] | None = None,
    *,
    gateway_running: bool = False,
    gateway_state: str | None = None,
    gateway_error: str | None = None,
) -> List[Dict[str, Any]]:
    catalog = _platform_catalog()
    runtime_platforms = runtime_platforms if isinstance(runtime_platforms, dict) else {}
    result: List[Dict[str, Any]] = []
    for platform_id, meta in catalog.items():
        saved = get_dotenv_values_for_keys(meta["fields"])
        required = list(meta["required"])
        runtime = runtime_platforms.get(platform_id)
        runtime = runtime if isinstance(runtime, dict) else {}
        enabled, configured = _platform_configuration(
            platform_id, required, saved, runtime
        )
        runtime_state = str(runtime.get("state") or "").strip()
        if not enabled:
            state = "disabled"
        elif not configured:
            state = "not_configured"
        elif runtime_state:
            state = runtime_state
        elif gateway_running:
            state = "pending_restart"
        elif gateway_state == "startup_failed":
            state = "startup_failed"
        else:
            state = "gateway_stopped"
        error_message = str(runtime.get("error_message") or "")
        if state == "startup_failed" and not error_message:
            error_message = str(gateway_error or "")
        fields = []
        for key in meta["fields"]:
            field_meta = meta.get("field_meta", {}).get(key, {})
            secret = _is_secret_field(key, field_meta)
            field = {
                "key": key,
                "required": key in required,
                "configured": _has_field_value(key, saved.get(key)),
                "label": str(field_meta.get("prompt") or key),
                "description": str(field_meta.get("description") or ""),
                "help": str(field_meta.get("help") or ""),
                "url": str(field_meta.get("url") or ""),
                "secret": secret,
                "advanced": bool(field_meta.get("advanced", False)),
            }
            if not secret:
                field["value"] = str(saved.get(key) or "")
            fields.append(field)
        result.append({
            "id": platform_id,
            "name": meta["name"],
            "description": str(meta.get("description") or ""),
            "docs_url": str(meta.get("docs_url") or ""),
            "enabled": enabled,
            "configured": configured,
            "gateway_running": gateway_running,
            "state": state,
            "error": error_message,
            "error_code": str(runtime.get("error_code") or ""),
            "updated_at": runtime.get("updated_at"),
            "fields": fields,
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
        from ....adapters.hermes_core import is_default_profile

        merge_dotenv_file_and_apply(
            updates,
            apply_process=is_default_profile(),
        )
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
