import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service import (
    delete_personality_response,
    list_personalities_response,
    save_personality_response,
    set_selected_personality_response,
)
from amiba_backplane.runtime.features.hermes_proxy.settings.personalities_routes import (
    register_personalities_routes,
)


def test_service_includes_builtins():
    items = list_personalities_response()
    keys = {p["key"] for p in items}
    assert "helpful" in keys
    assert "concise" in keys
    sample = next(p for p in items if p["key"] == "helpful")
    assert "preview" in sample
    assert "builtin" in sample
    assert "prompt" in sample
    assert sample["prompt"]
    assert "description" in sample
    assert sample["name"] == "helpful"
    assert "system_prompt" in sample
    assert "tone" in sample
    assert "style" in sample
    assert "overridden" in sample
    assert "selected" in sample


def test_service_writes_custom_personality(monkeypatch):
    raw = {}
    writes = []
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._read_raw_config",
        lambda: raw,
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._write_raw_config",
        lambda value: writes.append(value),
    )

    result = save_personality_response(
        "fact-checker",
        name="Fact checker",
        system_prompt="Verify every claim.",
        description="Checks sources",
        tone="direct",
        style="evidence first",
    )

    assert result == {"ok": True, "key": "fact-checker"}
    assert raw["agent"]["personalities"]["fact-checker"] == {
        "name": "Fact checker",
        "system_prompt": "Verify every claim.",
        "description": "Checks sources",
        "tone": "direct",
        "style": "evidence first",
    }
    assert writes == [raw]


def test_service_resets_builtin_override(monkeypatch):
    raw = {
        "agent": {
            "personalities": {
                "helpful": "A profile-specific override.",
                "custom": "Custom mode.",
            }
        }
    }
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._read_raw_config",
        lambda: raw,
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._write_raw_config",
        lambda value: None,
    )

    result = delete_personality_response("helpful")

    assert result["reset"] is True
    assert "helpful" not in raw["agent"]["personalities"]
    assert raw["agent"]["personalities"]["custom"] == "Custom mode."


def test_service_renames_custom_personality_and_keeps_default_selection(monkeypatch):
    raw = {
        "agent": {"personalities": {"reviewer": "Review every claim."}},
        "display": {"personality": "reviewer"},
    }
    writes = []
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._read_raw_config",
        lambda: raw,
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._resolved_personalities",
        lambda: {"reviewer": "Review every claim."},
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._write_raw_config",
        lambda value: writes.append(value),
    )

    result = save_personality_response(
        "fact-checker",
        name="Fact checker",
        previous_key="reviewer",
        system_prompt="Verify every important claim.",
    )

    assert result["key"] == "fact-checker"
    assert "reviewer" not in raw["agent"]["personalities"]
    assert raw["agent"]["personalities"]["fact-checker"] == {
        "name": "Fact checker",
        "system_prompt": "Verify every important claim.",
        "description": "",
        "tone": "",
        "style": "",
    }
    assert raw["display"]["personality"] == "fact-checker"
    assert raw["agent"]["system_prompt"] == "Verify every important claim."
    assert writes == [raw]


def test_service_selects_default_personality(monkeypatch):
    raw = {}
    writes = []
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._read_raw_config",
        lambda: raw,
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._resolved_personalities",
        lambda: {"concise": "Keep answers brief."},
    )
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_service._write_raw_config",
        lambda value: writes.append(value),
    )

    result = set_selected_personality_response("concise")

    assert result == {
        "ok": True,
        "key": "concise",
        "prompt": "Keep answers brief.",
    }
    assert raw["display"]["personality"] == "concise"
    assert raw["agent"]["system_prompt"] == "Keep answers brief."
    assert writes == [raw]


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    register_personalities_routes(app)
    return await aiohttp_client(app)


async def test_get_personalities_route(client):
    resp = await client.get("/hermes/personalities")
    assert resp.status == 200
    data = await resp.json()
    assert isinstance(data, list)
    assert any(p["key"] == "helpful" for p in data)


async def test_select_personality_route_uses_static_active_path(client, monkeypatch):
    monkeypatch.setattr(
        "amiba_backplane.runtime.features.hermes_proxy.settings.personalities_routes.set_selected_personality_response",
        lambda key: {"ok": True, "key": key},
    )

    resp = await client.put("/hermes/personalities/active", json={"key": "concise"})

    assert resp.status == 200
    assert await resp.json() == {"ok": True, "key": "concise"}
