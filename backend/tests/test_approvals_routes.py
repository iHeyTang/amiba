from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings import approvals_routes


@pytest.fixture
async def client(aiohttp_client, monkeypatch):
    scoped = []

    @contextmanager
    def fake_profile_scope(profile):
        scoped.append(profile)
        yield profile

    monkeypatch.setattr(approvals_routes, "hermes_profile_scope", fake_profile_scope)
    monkeypatch.setattr(
        approvals_routes,
        "current_profile_id",
        lambda: (scoped[-1] if scoped and scoped[-1] else "default"),
    )
    app = web.Application()
    approvals_routes.register_approvals_routes(app)
    client = await aiohttp_client(app)
    client.scoped_profiles = scoped
    return client


async def test_get_approval_mode_is_profile_scoped(client, monkeypatch):
    monkeypatch.setattr(
        approvals_routes,
        "_run_approval_mode",
        lambda requested: SimpleNamespace(ok=True, mode="smart"),
    )

    response = await client.get("/hermes/approvals/mode?profile=researcher")

    assert response.status == 200
    assert await response.json() == {
        "ok": True,
        "mode": "smart",
        "profile": "researcher",
    }
    assert client.scoped_profiles == ["researcher"]


async def test_put_approval_mode_uses_hermes_canonical_writer(client, monkeypatch):
    requested_modes = []

    def run(requested):
        requested_modes.append(requested)
        return SimpleNamespace(ok=True, mode=requested, changed=True, message="")

    monkeypatch.setattr(approvals_routes, "_run_approval_mode", run)

    response = await client.put(
        "/hermes/approvals/mode?profile=default",
        json={"mode": "off"},
    )

    assert response.status == 200
    assert await response.json() == {
        "ok": True,
        "mode": "off",
        "profile": "default",
        "changed": True,
    }
    assert requested_modes == ["off"]
    assert client.scoped_profiles == ["default"]


async def test_put_approval_mode_rejects_unknown_value(client):
    response = await client.put(
        "/hermes/approvals/mode",
        json={"mode": "always"},
    )

    assert response.status == 400
    assert "manual, smart, off" in (await response.json())["error"]


async def test_invalid_profile_is_returned_as_json_error(client, monkeypatch):
    @contextmanager
    def invalid_profile_scope(_profile):
        raise ValueError("Invalid Hermes profile 'bad profile'")
        yield

    monkeypatch.setattr(
        approvals_routes,
        "hermes_profile_scope",
        invalid_profile_scope,
    )

    response = await client.get("/hermes/approvals/mode?profile=bad%20profile")

    assert response.status == 400
    assert "Invalid Hermes profile" in (await response.json())["error"]
