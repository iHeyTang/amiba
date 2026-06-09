import pytest
from aiohttp import web

from runtime.features.hermes_proxy.settings.personalities_service import (
    list_personalities_response,
)
from runtime.features.hermes_proxy.settings.personalities_routes import (
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
