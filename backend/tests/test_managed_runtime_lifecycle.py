from unittest.mock import AsyncMock, patch

import pytest
from aiohttp.test_utils import make_mocked_request

from amiba_backplane.runtime.features.hermes_proxy.lifecycle import routes, service


def test_managed_runtime_never_checks_upstream(monkeypatch):
    monkeypatch.setenv("AMIBA_MANAGED_HERMES", "1")
    assert service._update_check(force=True) == {
        "status": "managed",
        "commits_behind": 0,
    }


@pytest.mark.asyncio
async def test_managed_runtime_rejects_in_place_update(monkeypatch):
    monkeypatch.setenv("AMIBA_MANAGED_HERMES", "1")
    request = make_mocked_request("POST", "/hermes/update")
    with patch.object(routes, "spawn_hermes_action", new=AsyncMock()) as spawn:
        response = await routes.handle_update(request)
    assert response.status == 409
    spawn.assert_not_called()
