from unittest.mock import AsyncMock, MagicMock, patch

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


@pytest.mark.asyncio
async def test_restart_gateway_command_waits_for_ready_replacement(monkeypatch):
    class Proc:
        pid = 99

        @staticmethod
        def poll():
            return None

    observations = iter(
        [
            (10, {"gateway_state": "running"}),
            (10, {"gateway_state": "stopping"}),
            (11, {"gateway_state": "running"}),
        ]
    )
    monkeypatch.setattr(
        service,
        "_default_gateway_observation",
        lambda: next(observations),
    )
    spawn = MagicMock(return_value=Proc())
    monkeypatch.setattr(service, "spawn_hermes_action", spawn)

    result = await service.restart_gateway_and_wait(
        timeout_seconds=1,
        poll_interval=0.001,
    )

    spawn.assert_called_once_with(
        ["-p", "default", "gateway", "restart"],
        "gateway-restart",
    )
    assert result == {
        "ok": True,
        "name": "gateway-restart",
        "command_pid": 99,
        "previous_gateway_pid": 10,
        "gateway_pid": 11,
        "gateway_state": "running",
    }


@pytest.mark.asyncio
async def test_restart_gateway_command_surfaces_early_failure(monkeypatch):
    class Proc:
        pid = 100

        @staticmethod
        def poll():
            return 7

    monkeypatch.setattr(
        service,
        "_default_gateway_observation",
        lambda: (10, {"gateway_state": "stopping"}),
    )
    monkeypatch.setattr(service, "spawn_hermes_action", lambda *args: Proc())

    with pytest.raises(service.GatewayRestartError, match="code 7"):
        await service.restart_gateway_and_wait(
            timeout_seconds=1,
            poll_interval=0.001,
        )
