import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings.commands_routes import (
    register_commands_routes,
)


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    register_commands_routes(app)
    return await aiohttp_client(app)


async def test_get_commands_returns_json_array(client):
    resp = await client.get("/hermes/commands")
    assert resp.status == 200
    data = await resp.json()
    assert isinstance(data, list)
    assert any(c["name"] == "new" for c in data)
