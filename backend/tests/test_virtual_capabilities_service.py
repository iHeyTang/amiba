import pytest
from aiohttp import web

from amiba_backplane.runtime.features.hermes_proxy.settings import (
    model_routes,
    virtual_capabilities_service,
)


def test_read_moa_reports_explicit_configuration(monkeypatch):
    monkeypatch.setattr(
        virtual_capabilities_service,
        "load_hermes_config",
        lambda: {"moa": {"presets": {"review": {}}}},
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "normalize_moa_config",
        lambda raw: {
            "default_preset": "review",
            "active_preset": "",
            "presets": raw["presets"],
        },
    )

    response = virtual_capabilities_service.read_moa_config_response()

    assert response["ok"] is True
    assert response["configured"] is True
    assert response["default_preset"] == "review"


def test_write_moa_uses_upstream_normalizer_and_config_store(monkeypatch):
    saved = {}
    monkeypatch.setattr(
        virtual_capabilities_service,
        "load_hermes_config",
        lambda: {
            "model": {"provider": "openai"},
            "moa": {
                "save_traces": True,
                "trace_dir": "/tmp/moa-traces",
                "privacy_filter": "display",
            },
        },
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "validate_moa_config",
        lambda raw: [],
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "normalize_moa_config",
        lambda raw: {
            "default_preset": raw["default_preset"],
            "active_preset": raw["active_preset"],
            "presets": raw["presets"],
            "privacy_filter": raw.get("privacy_filter", ""),
        },
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "save_hermes_config",
        lambda config: saved.update(config),
    )

    response = virtual_capabilities_service.write_moa_config_response(
        {
            "default_preset": "review",
            "active_preset": "",
            "presets": {
                "review": {
                    "reference_models": [
                        {"provider": "openai", "model": "reference"}
                    ],
                    "aggregator": {
                        "provider": "openai",
                        "model": "aggregator",
                    },
                }
            },
        }
    )

    assert response["ok"] is True
    assert response["configured"] is True
    assert saved["model"] == {"provider": "openai"}
    assert saved["moa"]["default_preset"] == "review"
    assert saved["moa"]["save_traces"] is True
    assert saved["moa"]["trace_dir"] == "/tmp/moa-traces"
    assert saved["moa"]["privacy_filter"] == "display"
    assert response["save_traces"] is True


def test_write_moa_rejects_invalid_payload_before_normalizing(monkeypatch):
    saved = {}
    monkeypatch.setattr(
        virtual_capabilities_service,
        "load_hermes_config",
        lambda: {"moa": {}},
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "validate_moa_config",
        lambda raw: ["preset 'review': needs at least one complete reference model"],
    )
    monkeypatch.setattr(
        virtual_capabilities_service,
        "save_hermes_config",
        lambda config: saved.update(config),
    )

    with pytest.raises(ValueError, match="Invalid MoA config"):
        virtual_capabilities_service.write_moa_config_response(
            {
                "default_preset": "review",
                "active_preset": "",
                "presets": {"review": {"reference_models": []}},
            }
        )

    assert saved == {}


def test_moa_routes_are_mounted_on_the_model_surface():
    app = web.Application()
    model_routes.register_model_routes(app)
    routes = {
        (route.method, route.resource.canonical)
        for route in app.router.routes()
    }

    assert ("GET", "/hermes/model/moa") in routes
    assert ("PUT", "/hermes/model/moa") in routes
