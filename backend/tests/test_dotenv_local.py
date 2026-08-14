import os

import pytest

from amiba_backplane.runtime.adapters import dotenv_local


def test_merge_dotenv_replaces_file_before_publishing_process_env(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("AMIBA_TEST_OLD=old\n", encoding="utf-8")
    monkeypatch.setenv("AMIBA_TEST_OLD", "old")
    monkeypatch.delenv("AMIBA_TEST_NEW", raising=False)

    result = dotenv_local.merge_dotenv_file_and_apply(
        {"AMIBA_TEST_OLD": "", "AMIBA_TEST_NEW": "new"},
        base=tmp_path,
    )

    assert result == {"AMIBA_TEST_NEW": "new"}
    assert path.read_text(encoding="utf-8") == "AMIBA_TEST_NEW=new\n"
    assert "AMIBA_TEST_OLD" not in os.environ
    assert os.environ["AMIBA_TEST_NEW"] == "new"
    assert path.stat().st_mode & 0o777 == 0o600


def test_merge_dotenv_does_not_publish_env_when_atomic_replace_fails(
    tmp_path, monkeypatch
):
    path = tmp_path / ".env"
    path.write_text("AMIBA_TEST_ATOMIC=old\n", encoding="utf-8")
    monkeypatch.setenv("AMIBA_TEST_ATOMIC", "old")

    def fail_replace(source, destination):
        raise OSError("replace failed")

    monkeypatch.setattr(dotenv_local.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        dotenv_local.merge_dotenv_file_and_apply(
            {"AMIBA_TEST_ATOMIC": "new"},
            base=tmp_path,
        )

    assert path.read_text(encoding="utf-8") == "AMIBA_TEST_ATOMIC=old\n"
    assert os.environ["AMIBA_TEST_ATOMIC"] == "old"


def test_named_profile_does_not_fall_back_to_default_process_env(
    tmp_path, monkeypatch
):
    from amiba_backplane.runtime.adapters import hermes_core

    monkeypatch.setenv("CHAT_TOKEN", "default-profile-token")
    monkeypatch.setattr(
        dotenv_local,
        "plugin_dotenv_path",
        lambda _base=None: tmp_path / ".env",
    )
    monkeypatch.setattr(hermes_core, "is_default_profile", lambda: False)

    assert dotenv_local.get_dotenv_values_for_keys(["CHAT_TOKEN"]) == {
        "CHAT_TOKEN": ""
    }
