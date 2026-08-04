from contextlib import contextmanager

import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings import skills_routes


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    skills_routes.register_skills_routes(app)
    return await aiohttp_client(app)


async def test_skills_routes_enter_selected_profile_scope(client, monkeypatch):
    entered = []

    @contextmanager
    def fake_profile_scope(profile):
        entered.append(profile)
        yield

    monkeypatch.setattr(skills_routes, "hermes_profile_scope", fake_profile_scope)
    monkeypatch.setattr(
        skills_routes,
        "list_skills_response",
        lambda: {
            "skills": [
                {
                    "name": "research",
                    "description": "Researches sources",
                    "category": "web",
                    "enabled": True,
                }
            ]
        },
    )

    response = await client.get("/hermes/skills?profile=researcher")

    assert response.status == 200
    assert entered == ["researcher"]
    assert (await response.json())[0]["name"] == "research"


async def test_skill_toggle_uses_the_same_profile_scope(client, monkeypatch):
    entered = []

    @contextmanager
    def fake_profile_scope(profile):
        entered.append(profile)
        yield

    monkeypatch.setattr(skills_routes, "hermes_profile_scope", fake_profile_scope)
    monkeypatch.setattr(
        skills_routes,
        "toggle_skill",
        lambda name, enabled: {"ok": True, "name": name, "enabled": enabled},
    )

    response = await client.put(
        "/hermes/skills/toggle?profile=writer",
        json={"name": "research", "enabled": False},
    )

    assert response.status == 200
    assert entered == ["writer"]
    assert (await response.json())["enabled"] is False
