import json
import subprocess
import sys

import pytest

from amiba_backplane.runtime.adapters import hermes_core


@pytest.fixture(autouse=True)
def clear_personality_catalog_cache():
    hermes_core.clear_cli_personality_catalog_cache()
    yield
    hermes_core.clear_cli_personality_catalog_cache()


def test_catalog_is_exported_by_profile_scoped_hermes_child(
    monkeypatch, tmp_path
):
    marker = hermes_core._PERSONALITY_EXPORT_MARKER
    payload = {
        "effective": {"reviewer": "Review every claim."},
        "builtins": {"helpful": "Be helpful."},
    }
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=f"an upstream log line\n{marker}{json.dumps(payload)}\n",
            stderr="",
        )

    monkeypatch.setattr(hermes_core, "hermes_home", lambda: tmp_path)
    monkeypatch.setattr(hermes_core.subprocess, "run", fake_run)
    monkeypatch.setattr(
        hermes_core,
        "_cli_personality_source_stamp",
        lambda: ("/runtime/cli.py", (1, 2), (0, 0)),
    )

    first = hermes_core.load_cli_personality_catalog()
    second = hermes_core.load_cli_personality_catalog()

    assert first == (payload["effective"], payload["builtins"])
    assert second == first
    assert len(calls) == 1
    command, kwargs = calls[0]
    assert command[:2] == [sys.executable, "-c"]
    assert kwargs["env"]["HERMES_HOME"] == str(tmp_path.resolve())
    assert "HERMES_IGNORE_USER_CONFIG" not in kwargs["env"]
    assert kwargs["timeout"] == 15
    assert kwargs["check"] is False


def test_catalog_cache_tracks_profile_config_changes(monkeypatch, tmp_path):
    marker = hermes_core._PERSONALITY_EXPORT_MARKER
    config_path = tmp_path / "config.yaml"
    outputs = [
        {"effective": {"first": "One"}, "builtins": {"helpful": "Be helpful."}},
        {"effective": {"second": "Two"}, "builtins": {"helpful": "Be helpful."}},
    ]
    calls = []

    def fake_run(command, **kwargs):
        payload = outputs[len(calls)]
        calls.append(command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=f"{marker}{json.dumps(payload)}\n",
            stderr="",
        )

    monkeypatch.setattr(hermes_core, "hermes_home", lambda: tmp_path)
    monkeypatch.setattr(hermes_core.subprocess, "run", fake_run)
    monkeypatch.setattr(
        hermes_core,
        "_cli_personality_source_stamp",
        lambda: ("/runtime/cli.py", (1, 2), (0, 0)),
    )

    first, _ = hermes_core.load_cli_personality_catalog()
    config_path.write_text("agent: {}\n", encoding="utf-8")
    second, _ = hermes_core.load_cli_personality_catalog()

    assert first == {"first": "One"}
    assert second == {"second": "Two"}
    assert len(calls) == 2


def test_catalog_export_failure_is_reported(monkeypatch, tmp_path):
    monkeypatch.setattr(hermes_core, "hermes_home", lambda: tmp_path)
    monkeypatch.setattr(
        hermes_core.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(
            command,
            1,
            stdout="",
            stderr="Hermes import failed",
        ),
    )

    with pytest.raises(RuntimeError, match="Hermes import failed"):
        hermes_core.load_cli_personality_catalog()
