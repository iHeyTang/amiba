import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from amiba_backplane.runtime.features.hermes_proxy.settings import (
    messaging_routes,
    messaging_service,
)


def test_platform_list_is_secret_free_and_uses_runtime_state(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_platform_catalog",
        lambda: {
            "chat": {
                "name": "Chat",
                "required": ["CHAT_TOKEN"],
                "fields": ["CHAT_TOKEN", "CHAT_ROOM"],
                "field_meta": {
                    "CHAT_TOKEN": {"prompt": "Bot token", "password": True},
                    "CHAT_ROOM": {"prompt": "Home room"},
                },
            }
        },
    )
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {"chat": {"enabled": True}}},
    )
    monkeypatch.setattr(
        messaging_service,
        "get_dotenv_values_for_keys",
        lambda _keys: {"CHAT_TOKEN": "super-secret", "CHAT_ROOM": "room-1"},
    )

    rows = messaging_service.list_platforms(
        {"chat": {"state": "connected", "error_message": ""}}
    )

    assert rows[0]["enabled"] is True
    assert rows[0]["configured"] is True
    assert rows[0]["state"] == "connected"
    assert rows[0]["fields"][0] == {
        "key": "CHAT_TOKEN",
        "required": True,
        "configured": True,
        "label": "Bot token",
        "description": "",
        "help": "",
        "url": "",
        "secret": True,
        "advanced": False,
    }
    assert rows[0]["fields"][1]["value"] == "room-1"
    assert "super-secret" not in str(rows)


def test_save_platform_is_allow_listed_and_uses_hermes_writer(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_platform_catalog",
        lambda: {
            "chat": {
                "name": "Chat",
                "required": ["CHAT_TOKEN"],
                "fields": ["CHAT_TOKEN"],
            }
        },
    )
    env_updates = {}
    config_updates = []
    monkeypatch.setattr(
        messaging_service,
        "merge_dotenv_file_and_apply",
        lambda values, **_kwargs: env_updates.update(values),
    )

    import hermes_cli.config

    monkeypatch.setattr(
        hermes_cli.config,
        "write_platform_config_field",
        lambda *args: config_updates.append(args),
    )

    result = messaging_service.save_platform(
        "chat", {"enabled": True, "env": {"CHAT_TOKEN": " secret "}}
    )

    assert result == {"ok": True, "platform": "chat"}
    assert env_updates == {"CHAT_TOKEN": "secret"}
    assert config_updates == [("chat", "enabled", True)]

    with pytest.raises(ValueError, match="not configurable"):
        messaging_service.save_platform("chat", {"env": {"PATH": "/tmp"}})


def test_fallback_sms_uses_the_runtime_phone_number_key():
    sms = messaging_service.FALLBACK_PLATFORMS["sms"]

    assert "TWILIO_PHONE_NUMBER" in sms["required"]
    assert "TWILIO_FROM_NUMBER" not in sms["fields"]


def test_platform_configuration_uses_live_gateway_state(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {"chat": {"enabled": False}}},
    )

    assert messaging_service._platform_configuration(
        "chat",
        ["CHAT_TOKEN"],
        {"CHAT_TOKEN": ""},
        {"state": "connected"},
    ) == (True, True)


def test_disabled_channel_without_real_settings_is_not_configured(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {"webhook": {"enabled": False}}},
    )

    assert messaging_service._platform_configuration(
        "webhook", [], {"WEBHOOK_ENABLED": "false"}
    ) == (False, False)


def test_empty_required_field_list_is_not_vacuously_configured(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {}},
    )

    assert messaging_service._platform_configuration("a2a", [], {}) == (
        False,
        False,
    )


def test_disabled_channel_with_saved_credentials_remains_configured(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {"chat": {"enabled": False}}},
    )

    assert messaging_service._platform_configuration(
        "chat", ["CHAT_TOKEN"], {"CHAT_TOKEN": "saved"}
    ) == (False, True)


def test_saved_credentials_implicitly_enable_channel(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {}},
    )

    assert messaging_service._platform_configuration(
        "feishu",
        ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
        {"FEISHU_APP_ID": "app", "FEISHU_APP_SECRET": "secret"},
    ) == (True, True)


def test_false_enable_flag_is_not_configuration_evidence(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_config",
        lambda: {"platforms": {}},
    )

    assert messaging_service._platform_configuration(
        "whatsapp", ["WHATSAPP_ENABLED"], {"WHATSAPP_ENABLED": "false"}
    ) == (False, False)
    assert messaging_service._has_field_value("WHATSAPP_ENABLED", "false") is False


def test_catalog_does_not_expose_gateway_plumbing(monkeypatch):
    class PlatformMember:
        def __init__(self, value):
            self.value = value

    fake_platform = SimpleNamespace(
        __members__={
            "TELEGRAM": PlatformMember("telegram"),
            "API_SERVER": PlatformMember("api_server"),
            "RELAY": PlatformMember("relay"),
            "WEBHOOK": PlatformMember("webhook"),
        }
    )
    fake_registry = SimpleNamespace(plugin_entries=lambda: [])
    fake_config = SimpleNamespace(Platform=fake_platform)
    fake_gateway = SimpleNamespace(config=fake_config)
    fake_registry_module = SimpleNamespace(platform_registry=fake_registry)
    fake_hermes_config = SimpleNamespace(OPTIONAL_ENV_VARS={})
    fake_plugins = SimpleNamespace(discover_plugins=lambda: None)

    monkeypatch.setitem(sys.modules, "gateway", fake_gateway)
    monkeypatch.setitem(sys.modules, "gateway.config", fake_config)
    monkeypatch.setitem(
        sys.modules, "gateway.platform_registry", fake_registry_module
    )
    monkeypatch.setitem(sys.modules, "hermes_cli.config", fake_hermes_config)
    monkeypatch.setitem(sys.modules, "hermes_cli.plugins", fake_plugins)

    assert list(messaging_service._platform_catalog()) == ["telegram"]


def test_configured_channel_reports_gateway_stopped_without_runtime_state(monkeypatch):
    monkeypatch.setattr(
        messaging_service,
        "_platform_catalog",
        lambda: {
            "chat": {
                "name": "Chat",
                "required": ["CHAT_TOKEN"],
                "fields": ["CHAT_TOKEN"],
            }
        },
    )
    monkeypatch.setattr(
        messaging_service,
        "get_dotenv_values_for_keys",
        lambda _keys: {"CHAT_TOKEN": "configured"},
    )
    monkeypatch.setattr(
        messaging_service,
        "_platform_configuration",
        lambda *_args: (True, True),
    )

    rows = messaging_service.list_platforms(
        {}, gateway_running=False, gateway_state="stopped"
    )

    assert rows[0]["gateway_running"] is False
    assert rows[0]["state"] == "gateway_stopped"


@pytest.mark.asyncio
async def test_platform_route_passes_real_gateway_snapshot_to_catalog(monkeypatch):
    captured = {}

    async def status():
        return {
            "gateway_running": True,
            "gateway_state": "running",
            "gateway_exit_reason": None,
            "gateway_platforms": {"telegram": {"state": "connected"}},
        }

    def list_rows(runtime, **kwargs):
        captured["runtime"] = runtime
        captured["kwargs"] = kwargs
        return [{"id": "telegram", "state": "connected"}]

    monkeypatch.setattr(messaging_routes, "status_response", status)
    monkeypatch.setattr(messaging_routes, "list_platforms", list_rows)
    monkeypatch.setattr(
        messaging_routes,
        "plugin_dotenv_path",
        lambda: Path("/profiles/default/.env"),
    )

    response = await messaging_routes.handle_platforms(SimpleNamespace())
    payload = json.loads(response.text)

    assert payload["gateway_running"] is True
    assert payload["gateway_state"] == "running"
    assert payload["env_path"] == "/profiles/default/.env"
    assert captured == {
        "runtime": {"telegram": {"state": "connected"}},
        "kwargs": {
            "gateway_running": True,
            "gateway_state": "running",
            "gateway_error": None,
        },
    }


def test_webhook_update_supports_full_crud_without_erasing_secret(monkeypatch):
    saved = {}
    subscriptions = {
        "build": {
            "description": "old",
            "events": ["push"],
            "deliver": "log",
            "prompt": "",
            "skills": [],
            "secret": "keep-me",
            "enabled": True,
        }
    }
    fake = SimpleNamespace(
        _load_subscriptions=lambda: subscriptions,
        _save_subscriptions=lambda value: saved.update(value),
    )
    import hermes_cli

    monkeypatch.setattr(hermes_cli, "webhook", fake, raising=False)
    monkeypatch.setitem(sys.modules, "hermes_cli.webhook", fake)

    result = messaging_service.mutate_webhook(
        "build",
        updates={
            "description": "new",
            "events": ["push", " release "],
            "enabled": False,
            "secret": "",
        },
    )

    assert result == {"ok": True, "name": "build"}
    assert saved["build"]["description"] == "new"
    assert saved["build"]["events"] == ["push", "release"]
    assert saved["build"]["enabled"] is False
    assert saved["build"]["secret"] == "keep-me"
