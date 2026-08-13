import sys
from types import SimpleNamespace

import pytest

from amiba_backplane.runtime.features.hermes_proxy.settings import messaging_service


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
        "secret": True,
    }
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
        lambda values: env_updates.update(values),
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
