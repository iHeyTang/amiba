import json
import sys
from types import ModuleType, SimpleNamespace

import pytest

from amiba_backplane.runtime.features.hermes_proxy.settings import model_routes


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("refresh_value", "expected_refresh"),
    [("0", False), ("1", True)],
)
async def test_model_options_requests_complete_hermes_inventory(
    monkeypatch, refresh_value, expected_refresh
):
    calls = {}
    context = SimpleNamespace(user_providers={})

    def build_models_payload(received_context, **kwargs):
        calls["context"] = received_context
        calls["kwargs"] = kwargs
        return {"providers": [], "model": "", "provider": ""}

    inventory = ModuleType("hermes_cli.inventory")
    inventory.build_models_payload = build_models_payload
    inventory.load_picker_context = lambda: context
    hermes_cli = ModuleType("hermes_cli")
    hermes_cli.__path__ = []
    hermes_cli.inventory = inventory
    monkeypatch.setitem(sys.modules, "hermes_cli", hermes_cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.inventory", inventory)
    monkeypatch.setattr(
        model_routes,
        "_user_configured_canonical_slugs",
        lambda received_context: [],
    )

    async def expand(payload, *, force_refresh=False):
        calls["expanded"] = (payload, force_refresh)

    monkeypatch.setattr(model_routes, "_expand_ai_gateway_models", expand)
    monkeypatch.setattr(
        model_routes,
        "enrich_models_payload",
        lambda payload: calls.setdefault("enriched", payload),
    )

    response = await model_routes.handle_model_options(
        SimpleNamespace(query={"refresh": refresh_value})
    )

    assert response.status == 200
    assert json.loads(response.text)["providers"] == []
    assert calls["context"] is context
    assert calls["kwargs"] == {
        "include_unconfigured": True,
        "picker_hints": True,
        "canonical_order": True,
        "pricing": True,
        "capabilities": True,
        "refresh": expected_refresh,
        "probe_custom_providers": expected_refresh,
        "probe_current_custom_provider": not expected_refresh,
        "for_picker": True,
    }
    assert calls["expanded"][1] is expected_refresh
    assert calls["enriched"]["providers"] == []


def test_profile_runtime_connection_overrides_ambient_inventory_auth(monkeypatch):
    payload = {
        "providers": [
            {
                "slug": "deepseek",
                "source": "built-in",
                "auth_type": "api_key",
                "authenticated": True,
                "key_env": "DEEPSEEK_API_KEY",
            }
        ]
    }
    monkeypatch.setattr(model_routes, "current_profile_id", lambda: "researcher")
    monkeypatch.setattr(model_routes, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(model_routes, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(
        model_routes,
        "env_var_names_for_slug",
        lambda slug: ["DEEPSEEK_API_KEY"],
    )
    monkeypatch.setattr(model_routes, "get_provider_profile", lambda slug: None)
    monkeypatch.setattr(
        model_routes,
        "build_provider_connection",
        lambda *args, **kwargs: {
            "status": "none",
            "active_method": "",
            "active_scope": "none",
            "methods": [],
            "service": {"status": "not_checked", "reason": ""},
        },
    )

    model_routes._apply_profile_runtime_connections(payload)

    row = payload["providers"][0]
    assert row["authenticated"] is False
    assert row["credential_scope"] == "none"
    assert row["connection"]["status"] == "none"
