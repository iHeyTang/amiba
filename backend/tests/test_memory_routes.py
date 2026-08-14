from contextlib import contextmanager

import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings import (
    memory_routes,
    memory_service,
)


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    memory_routes.register_memory_routes(app)
    return await aiohttp_client(app)


async def test_memory_routes_scope_reads_to_requested_profile(
    client,
    monkeypatch,
):
    scoped = []

    @contextmanager
    def fake_profile_scope(profile):
        scoped.append(profile)
        yield profile

    monkeypatch.setattr(
        memory_routes,
        "hermes_profile_scope",
        fake_profile_scope,
    )
    monkeypatch.setattr(
        memory_routes,
        "read_memory_entries_response",
        lambda target: {
            "ok": True,
            "target": target,
            "path": f"/profiles/researcher/memories/{target}.md",
            "entries": [],
            "char_count": 0,
            "char_limit": 100,
            "flagged_count": 0,
        },
    )

    response = await client.get(
        "/hermes/memories?profile=researcher",
    )

    assert response.status == 200
    assert scoped == ["researcher"]
    assert len((await response.json())["targets"]) == 2


def test_memory_directory_is_resolved_for_each_request(monkeypatch, tmp_path):
    homes = iter([tmp_path / "default", tmp_path / "profiles" / "researcher"])
    monkeypatch.setattr(memory_service, "hermes_home", lambda: next(homes))

    assert memory_service._memory_dir() == tmp_path / "default" / "memories"
    assert (
        memory_service._memory_dir()
        == tmp_path / "profiles" / "researcher" / "memories"
    )


def test_memory_provider_selection_uses_discovered_available_provider(monkeypatch):
    config = {"memory": {"provider": ""}}
    saved = {}
    monkeypatch.setattr(
        memory_service,
        "memory_configuration",
        lambda: {
            "ok": True,
            "provider": "",
            "providers": [
                {"name": "", "available": True},
                {"name": "mem0", "available": True},
                {"name": "missing", "available": False},
            ],
        },
    )
    monkeypatch.setattr(memory_service, "_load_config", lambda: config)
    monkeypatch.setattr(
        memory_service,
        "_save_config",
        lambda next_config: saved.update(next_config),
    )

    assert memory_service.select_memory_provider("mem0") == {
        "ok": True,
        "provider": "mem0",
    }
    assert saved["memory"]["provider"] == "mem0"
    with pytest.raises(ValueError, match="not available"):
        memory_service.select_memory_provider("missing")
