"""Tests for the /health endpoint shape, including protocol_version."""
import pytest
from aiohttp import web

from amiba_backplane.runtime.http_app import build_http_app
from amiba_backplane.runtime.protocol import PROTOCOL_VERSION


@pytest.fixture
async def client(aiohttp_client):
    app = build_http_app()
    return await aiohttp_client(app)


async def test_health_ok(client):
    resp = await client.get("/health")
    assert resp.status == 200


async def test_health_json_shape(client):
    resp = await client.get("/health")
    data = await resp.json()
    assert data["ok"] is True
    assert "plugin_version" in data
    assert "protocol_version" in data


async def test_health_protocol_version(client):
    resp = await client.get("/health")
    data = await resp.json()
    assert data["protocol_version"] == PROTOCOL_VERSION
    assert isinstance(data["protocol_version"], int)


async def test_health_protocol_version_value(client):
    resp = await client.get("/health")
    data = await resp.json()
    # Current contract version is 1; bump this when a breaking change ships.
    assert data["protocol_version"] == 1
