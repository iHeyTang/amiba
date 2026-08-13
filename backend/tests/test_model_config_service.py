from amiba_backplane.runtime.features.hermes_proxy.settings import (
    model_config_service as service,
)


def test_main_model_write_preserves_base_url_when_field_is_omitted(monkeypatch):
    received = {}

    def write_main_model(**kwargs):
        received.update(kwargs)
        return {"provider": "deepseek", "model": "deepseek-chat"}

    monkeypatch.setattr(service, "write_main_model", write_main_model)

    response = service.write_main_model_response(
        {"provider": "deepseek", "model": "deepseek-chat"}
    )

    assert "base_url" not in received
    assert response["ok"] is True


def test_main_model_write_forwards_explicit_null_to_clear_base_url(monkeypatch):
    received = {}

    def write_main_model(**kwargs):
        received.update(kwargs)
        return {
            "provider": "deepseek",
            "model": "deepseek-chat",
            "base_url": None,
        }

    monkeypatch.setattr(service, "write_main_model", write_main_model)

    response = service.write_main_model_response(
        {
            "provider": "deepseek",
            "model": "deepseek-chat",
            "base_url": None,
        }
    )

    assert "base_url" in received
    assert received["base_url"] is None
    assert response["base_url"] is None
