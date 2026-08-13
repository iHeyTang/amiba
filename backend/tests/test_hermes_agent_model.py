import yaml

from amiba_backplane.runtime.adapters import hermes_agent_model as adapter


def _write_config(path, *, base_url):
    path.write_text(
        yaml.safe_dump(
            {
                "model": {
                    "provider": "custom",
                    "default": "legacy-model",
                    "base_url": base_url,
                }
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def test_main_model_write_omission_preserves_existing_base_url(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    _write_config(config_path, base_url="https://openrouter.ai/api/v1")
    monkeypatch.setattr(adapter, "_config_yaml_path", lambda: config_path)

    result = adapter.write_main_model(
        provider="deepseek",
        model="deepseek-chat",
    )

    assert result["base_url"] == "https://openrouter.ai/api/v1"


def test_main_model_write_explicit_null_clears_existing_base_url(
    tmp_path,
    monkeypatch,
):
    config_path = tmp_path / "config.yaml"
    _write_config(config_path, base_url="https://openrouter.ai/api/v1")
    monkeypatch.setattr(adapter, "_config_yaml_path", lambda: config_path)

    result = adapter.write_main_model(
        provider="deepseek",
        model="deepseek-chat",
        base_url=None,
    )

    persisted = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert "base_url" not in persisted["model"]
    assert result["base_url"] is None
