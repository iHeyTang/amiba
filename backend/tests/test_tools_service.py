from types import SimpleNamespace

import pytest

from amiba_backplane.runtime.features.hermes_proxy.settings import tools_service


def test_list_toolsets_uses_each_toolsets_configuration_platform(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [
            ("web", "🔍 Web Search", "search"),
            ("discord", "💬 Discord", "messages"),
        ],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: {})
    monkeypatch.setattr(
        tools_service,
        "_toolset_platform",
        lambda name: "discord" if name == "discord" else "cli",
    )
    monkeypatch.setattr(
        tools_service,
        "_enabled_toolset_keys",
        lambda _config, platform: {"discord"} if platform == "discord" else {"web"},
    )
    monkeypatch.setattr(tools_service, "_platform_label", lambda value: value.upper())
    monkeypatch.setattr(tools_service, "_toolset_configured", lambda *_args: True)
    monkeypatch.setattr(tools_service, "_toolset_tools", lambda name: [f"{name}_tool"])

    rows = tools_service.list_toolsets()

    assert rows[0]["label"] == "Web Search"
    assert rows[0]["platform"] == "cli"
    assert rows[0]["enabled"] is True
    assert rows[1]["platform"] == "discord"
    assert rows[1]["platform_label"] == "DISCORD"
    assert rows[1]["tools"] == ["discord_tool"]


def test_provider_readiness_requires_a_usable_provider(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_provider_matrix",
        lambda *_args: (
            [
                {"name": "Local", "status": "needs_setup"},
                {"name": "Cloud", "status": "needs_keys"},
            ],
            None,
        ),
    )

    assert tools_service._toolset_configured("browser", {}) is False

    monkeypatch.setattr(
        tools_service,
        "_provider_matrix",
        lambda *_args: ([{"name": "Local", "status": "ready"}], "Local"),
    )
    assert tools_service._toolset_configured("browser", {}) is True


def test_vision_readiness_uses_dedicated_or_confirmed_main_model(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_main_model_supports_vision",
        lambda _config: False,
    )

    assert tools_service._toolset_configured("vision", {}) is False
    assert (
        tools_service._toolset_configured(
            "vision",
            {"auxiliary": {"vision": {"model": "image-model"}}},
        )
        is True
    )

    monkeypatch.setattr(
        tools_service,
        "_main_model_supports_vision",
        lambda _config: True,
    )
    assert (
        tools_service._toolset_configured(
            "vision",
            {"model": {"provider": "example", "default": "multimodal"}},
        )
        is True
    )


def test_video_readiness_uses_the_shared_vision_model_route(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_provider_matrix",
        lambda *_args: ([], None),
    )

    assert tools_service._toolset_configured("video", {}) is False
    assert (
        tools_service._toolset_configured(
            "video",
            {"auxiliary": {"vision": {"model": "shared-multimodal"}}},
        )
        is True
    )


def test_save_toolset_env_writes_only_declared_non_blank_values(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [("web", "Web", "")],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: {})
    monkeypatch.setattr(
        tools_service,
        "_visible_provider_rows",
        lambda *_args: [
            {
                "name": "Example",
                "env_vars": [
                    {"key": "EXAMPLE_API_KEY"},
                    {"key": "EXAMPLE_URL"},
                ],
            }
        ],
    )
    monkeypatch.setattr(
        tools_service,
        "_env_key_is_set",
        lambda key: key == "EXAMPLE_API_KEY",
    )
    captured = {}
    monkeypatch.setattr(
        tools_service,
        "merge_dotenv_file_and_apply",
        lambda values, **_kwargs: captured.update(values),
    )

    result = tools_service.save_toolset_env(
        "web",
        {"EXAMPLE_API_KEY": "  secret  ", "EXAMPLE_URL": "   "},
    )

    assert captured == {"EXAMPLE_API_KEY": "secret"}
    assert result["saved"] == ["EXAMPLE_API_KEY"]
    assert result["skipped"] == ["EXAMPLE_URL"]
    assert result["is_set"]["EXAMPLE_API_KEY"] is True


def test_save_toolset_env_rejects_undeclared_keys(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [("web", "Web", "")],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: {})
    monkeypatch.setattr(tools_service, "_visible_provider_rows", lambda *_args: [])

    with pytest.raises(ValueError, match="Unknown env var"):
        tools_service.save_toolset_env("web", {"PATH": "/tmp"})


def test_post_setup_is_scoped_to_declared_toolset_action(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [("browser", "Browser", "")],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: {})
    monkeypatch.setattr(
        tools_service,
        "_declared_post_setup_keys",
        lambda *_args: {"agent_browser"},
    )
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout="installed", stderr="")

    monkeypatch.setattr(tools_service.subprocess, "run", fake_run)

    result = tools_service.run_toolset_post_setup("browser", "agent_browser")

    assert result["ok"] is True
    assert result["output"] == "installed"
    assert calls[0][0][-3:] == ["tools", "post-setup", "agent_browser"]

    with pytest.raises(ValueError, match="Unknown post-setup key"):
        tools_service.run_toolset_post_setup("browser", "arbitrary-command")


def test_terminal_backend_selection_and_fields_are_allow_listed(monkeypatch):
    saved_config = {}
    monkeypatch.setattr(
        tools_service,
        "_load_config",
        lambda: {"terminal": {"backend": "local"}},
    )
    monkeypatch.setattr(
        tools_service,
        "_save_config",
        lambda config: saved_config.update(config),
    )

    selected = tools_service.select_terminal_backend("ssh")

    assert selected == {"ok": True, "backend": "ssh"}
    assert saved_config["terminal"]["backend"] == "ssh"
    with pytest.raises(ValueError, match="Unknown terminal backend"):
        tools_service.select_terminal_backend("arbitrary")

    captured = {}
    monkeypatch.setattr(
        tools_service,
        "merge_dotenv_file_and_apply",
        lambda values, **_kwargs: captured.update(values),
    )
    monkeypatch.setattr(tools_service, "_env_key_is_set", lambda key: key in captured)
    result = tools_service.save_terminal_env(
        {
            "TERMINAL_SSH_HOST": " example.com ",
            "TERMINAL_SSH_USER": "amiba",
        }
    )
    assert captured == {
        "TERMINAL_SSH_HOST": "example.com",
        "TERMINAL_SSH_USER": "amiba",
    }
    assert result["is_set"]["TERMINAL_SSH_HOST"] is True
    with pytest.raises(ValueError, match="Unknown terminal setting"):
        tools_service.save_terminal_env({"PATH": "/tmp"})


def test_computer_use_grant_runs_only_fixed_hermes_action(monkeypatch):
    monkeypatch.setattr(tools_service.sys, "platform", "darwin")
    calls = []

    def fake_popen(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(pid=42)

    monkeypatch.setattr(tools_service.subprocess, "Popen", fake_popen)

    result = tools_service.grant_computer_use_permissions()

    assert result == {"ok": True, "pid": 42}
    assert calls[0][0][-3:] == ["computer-use", "permissions", "grant"]
    assert calls[0][1]["start_new_session"] is True
