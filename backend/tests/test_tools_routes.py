from contextlib import contextmanager

import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings import tools_routes


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    tools_routes.register_tools_routes(app)
    return await aiohttp_client(app)


async def test_provider_route_validates_and_forwards_capability(client, monkeypatch):
    captured = {}

    def fake_select(name, provider, *, capability=None):
        captured.update(
            {"name": name, "provider": provider, "capability": capability}
        )
        return {"ok": True, **captured}

    monkeypatch.setattr(tools_routes, "select_toolset_provider", fake_select)

    response = await client.put(
        "/hermes/tools/toolsets/web/provider",
        json={"provider": "Example Search", "capability": "search"},
    )

    assert response.status == 200
    assert captured == {
        "name": "web",
        "provider": "Example Search",
        "capability": "search",
    }

    invalid = await client.put(
        "/hermes/tools/toolsets/web/provider",
        json={"provider": ""},
    )
    assert invalid.status == 400


async def test_tools_routes_scope_reads_to_requested_profile(client, monkeypatch):
    scoped = []

    @contextmanager
    def fake_profile_scope(profile):
        scoped.append(profile)
        yield profile

    monkeypatch.setattr(tools_routes, "hermes_profile_scope", fake_profile_scope)
    monkeypatch.setattr(tools_routes, "list_toolsets", lambda: [])

    response = await client.get(
        "/hermes/tools/toolsets?profile=researcher",
    )

    assert response.status == 200
    assert scoped == ["researcher"]


async def test_managed_apps_federation_accepts_only_loopback(client, monkeypatch):
    captured = {}

    def fake_configure(url):
        captured["url"] = url
        return {"ok": True, "url": url}

    monkeypatch.setattr(
        tools_routes,
        "configure_managed_apps_federation",
        fake_configure,
    )
    response = await client.put(
        "/hermes/tools/managed-apps-federation",
        json={"url": "http://127.0.0.1:43123/mcp"},
    )
    assert response.status == 200
    assert captured == {"url": "http://127.0.0.1:43123/mcp"}

    invalid = await client.put(
        "/hermes/tools/managed-apps-federation",
        json={"url": 42},
    )
    assert invalid.status == 400


async def test_installed_mcp_connection_route_resolves_provider_id(client, monkeypatch):
    monkeypatch.setattr(
        tools_routes,
        "get_installed_mcp_connection",
        lambda slug: {"providerId": slug, "url": "https://example.com/mcp"},
    )
    response = await client.get("/hermes/tools/installed-mcps/docs/connection")
    assert response.status == 200
    assert (await response.json())["connection"]["providerId"] == "docs"


async def test_env_route_requires_object_and_never_expands_surface(client, monkeypatch):
    monkeypatch.setattr(
        tools_routes,
        "save_toolset_env",
        lambda name, values: {
            "ok": True,
            "name": name,
            "saved": sorted(values),
        },
    )

    response = await client.put(
        "/hermes/tools/toolsets/web/env",
        json={"env": {"EXAMPLE_API_KEY": "secret"}},
    )
    assert response.status == 200
    assert (await response.json())["saved"] == ["EXAMPLE_API_KEY"]

    invalid = await client.put(
        "/hermes/tools/toolsets/web/env",
        json={"env": ["EXAMPLE_API_KEY"]},
    )
    assert invalid.status == 400


async def test_model_and_setup_routes(client, monkeypatch):
    monkeypatch.setattr(
        tools_routes,
        "get_toolset_models",
        lambda name, provider: {
            "ok": True,
            "name": name,
            "provider": provider,
            "has_models": True,
            "models": [{"id": "model-1"}],
        },
    )
    monkeypatch.setattr(
        tools_routes,
        "select_toolset_model",
        lambda name, model, *, provider_name=None: {
            "ok": True,
            "name": name,
            "model": model,
            "provider": provider_name,
        },
    )
    monkeypatch.setattr(
        tools_routes,
        "run_toolset_post_setup",
        lambda name, key: {"ok": True, "name": name, "key": key},
    )

    models = await client.get(
        "/hermes/tools/toolsets/image_gen/models?provider=Example",
    )
    assert models.status == 200
    assert (await models.json())["provider"] == "Example"

    model = await client.put(
        "/hermes/tools/toolsets/image_gen/model",
        json={"model": "model-1", "provider": "Example"},
    )
    assert model.status == 200
    assert (await model.json())["model"] == "model-1"

    setup = await client.post(
        "/hermes/tools/toolsets/browser/post-setup",
        json={"key": "agent_browser"},
    )
    assert setup.status == 200
    assert (await setup.json())["key"] == "agent_browser"


async def test_terminal_and_computer_use_routes(client, monkeypatch):
    monkeypatch.setattr(
        tools_routes,
        "get_terminal_backends",
        lambda: {"ok": True, "active": "local", "backends": []},
    )
    monkeypatch.setattr(
        tools_routes,
        "select_terminal_backend",
        lambda backend: {"ok": True, "backend": backend},
    )
    monkeypatch.setattr(
        tools_routes,
        "save_terminal_env",
        lambda values: {"ok": True, "saved": sorted(values)},
    )
    monkeypatch.setattr(
        tools_routes,
        "get_computer_use_status",
        lambda: {"ok": True, "installed": True, "ready": False},
    )
    monkeypatch.setattr(
        tools_routes,
        "grant_computer_use_permissions",
        lambda: {"ok": True, "pid": 42},
    )

    backends = await client.get("/hermes/tools/terminal/backends")
    assert backends.status == 200
    assert (await backends.json())["active"] == "local"

    selected = await client.put(
        "/hermes/tools/terminal/backend",
        json={"backend": "docker"},
    )
    assert selected.status == 200
    assert (await selected.json())["backend"] == "docker"

    env = await client.put(
        "/hermes/tools/terminal/env",
        json={"env": {"TERMINAL_DOCKER_IMAGE": "python:3.12"}},
    )
    assert env.status == 200
    assert (await env.json())["saved"] == ["TERMINAL_DOCKER_IMAGE"]

    status = await client.get("/hermes/tools/computer-use/status")
    assert status.status == 200
    assert (await status.json())["installed"] is True

    grant = await client.post(
        "/hermes/tools/computer-use/permissions/grant",
    )
    assert grant.status == 200
    assert (await grant.json())["pid"] == 42
