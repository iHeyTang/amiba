from types import SimpleNamespace

import pytest

from amiba_backplane.runtime import hermes_compatibility


def test_minimum_hermes_version_boundary():
    assert hermes_compatibility.MINIMUM_HERMES_VERSION == "0.19.0"
    assert hermes_compatibility.version_is_supported("Hermes Agent v0.19.0")
    assert hermes_compatibility.version_is_supported("0.20.0")
    assert not hermes_compatibility.version_is_supported("0.18.99")
    assert not hermes_compatibility.version_is_supported("0.19.0rc1")
    assert not hermes_compatibility.version_is_supported("unknown")


@pytest.mark.asyncio
async def test_version_gate_rejects_unsupported_functional_requests(monkeypatch):
    monkeypatch.setattr(
        hermes_compatibility,
        "hermes_compatibility_status",
        lambda: {
            "hermes_version": "0.16.9",
            "minimum_hermes_version": "0.19.0",
            "hermes_version_compatible": False,
            "hermes_version_error": "unsupported",
        },
    )
    request = SimpleNamespace(method="GET", path="/hermes/model/options")
    handler = lambda _request: None

    response = await hermes_compatibility.hermes_compatibility_middleware(
        request, handler
    )

    assert response.status == 426
    assert response.headers["X-Amiba-Error-Code"] == "hermes_version_unsupported"
    assert response.headers["X-Minimum-Hermes-Version"] == "0.19.0"


@pytest.mark.asyncio
async def test_status_and_update_remain_available(monkeypatch):
    monkeypatch.setattr(
        hermes_compatibility,
        "hermes_compatibility_status",
        lambda: {
            "hermes_version": "0.16.9",
            "minimum_hermes_version": "0.19.0",
            "hermes_version_compatible": False,
            "hermes_version_error": "unsupported",
        },
    )

    async def handler(_request):
        return "allowed"

    for method, path in (
        ("GET", "/hermes/status"),
        ("POST", "/hermes/update"),
        ("GET", "/hermes/actions/hermes-update/status"),
    ):
        request = SimpleNamespace(method=method, path=path)
        assert (
            await hermes_compatibility.hermes_compatibility_middleware(
                request, handler
            )
            == "allowed"
        )
