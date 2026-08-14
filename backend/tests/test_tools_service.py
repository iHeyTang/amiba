import sys
from types import ModuleType, SimpleNamespace

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
        lambda name: "discord" if name == "discord" else "api_server",
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
    assert rows[0]["platform"] == "api_server"
    assert rows[0]["enabled"] is True
    assert rows[1]["platform"] == "discord"
    assert rows[1]["platform_label"] == "DISCORD"
    assert rows[1]["tools"] == ["discord_tool"]


def test_configurable_toolsets_exposes_kanban_without_patching_hermes(monkeypatch):
    hermes_cli = ModuleType("hermes_cli")
    tools_config = ModuleType("hermes_cli.tools_config")
    tools_config._get_effective_configurable_toolsets = lambda: [
        ("web", "Web", "search")
    ]
    hermes_cli.tools_config = tools_config
    monkeypatch.setitem(sys.modules, "hermes_cli", hermes_cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.tools_config", tools_config)

    rows = tools_service._configurable_toolsets()

    assert [row[0] for row in rows] == ["web", "kanban"]
    assert tools_service._toolset_platform("kanban") == "api_server"


def test_profile_toolsets_target_api_server_and_keep_native_platforms():
    assert tools_service._toolset_platform("web") == "api_server"
    assert tools_service._toolset_platform("terminal") == "api_server"
    assert tools_service._toolset_platform("discord") == "discord"


def test_a2a_peers_never_return_tokens_and_preserve_write_only_auth(monkeypatch):
    config = {
        "a2a_agents": {
            "researcher": {
                "url": "https://agents.example/researcher",
                "auth": {"type": "bearer", "token": "secret-token"},
                "timeout": 90,
                "capabilities": ["research"],
            }
        }
    }
    saved = []
    monkeypatch.setattr(tools_service, "_load_config", lambda: config)
    monkeypatch.setattr(
        tools_service,
        "_save_config",
        lambda next_config: saved.append(next_config.copy()),
    )

    listed = tools_service.list_a2a_peers()
    assert listed["peers"][0]["auth_configured"] is True
    assert "token" not in listed["peers"][0]

    result = tools_service.save_a2a_peer(
        "researcher",
        url="https://agents.example/new",
        timeout=120,
        capabilities=["research", "research", "web_search"],
    )
    assert result["peer"]["capabilities"] == ["research", "web_search"]
    assert config["a2a_agents"]["researcher"]["auth"]["token"] == "secret-token"
    assert saved


def test_a2a_peer_validation_rejects_unsafe_urls():
    with pytest.raises(ValueError, match="http"):
        tools_service.save_a2a_peer("researcher", url="file:///tmp/agent")
    with pytest.raises(ValueError, match="credentials"):
        tools_service.save_a2a_peer(
            "researcher",
            url="https://user:pass@agents.example",
        )


def test_legacy_cli_selection_migrates_once_without_overwriting_api_server(
    monkeypatch,
):
    config = {"platform_toolsets": {"cli": ["web", "terminal"]}}
    saved = []
    monkeypatch.setattr(
        tools_service,
        "_enabled_toolset_keys",
        lambda _config, platform: {"web", "terminal"} if platform == "cli" else set(),
    )
    monkeypatch.setattr(
        tools_service,
        "_save_platform_toolsets",
        lambda next_config, platform, enabled: next_config["platform_toolsets"].__setitem__(
            platform, sorted(enabled)
        ),
    )
    monkeypatch.setattr(
        tools_service,
        "_save_config",
        lambda next_config: saved.append(next_config.copy()),
    )

    assert tools_service._migrate_legacy_profile_toolsets(config) is True
    assert config["platform_toolsets"]["api_server"] == ["terminal", "web"]
    assert len(saved) == 1

    config["platform_toolsets"]["cli"] = []
    assert tools_service._migrate_legacy_profile_toolsets(config) is False
    assert config["platform_toolsets"]["api_server"] == ["terminal", "web"]
    assert len(saved) == 1


def test_kanban_is_enabled_only_when_profile_and_api_server_are_enabled(
    monkeypatch,
):
    monkeypatch.setattr(
        tools_service,
        "_enabled_toolset_keys",
        lambda _config, _platform: {"kanban"},
    )

    assert tools_service._toolset_enabled(
        "kanban",
        {"toolsets": ["kanban"]},
        "api_server",
    ) is True
    assert tools_service._toolset_enabled(
        "kanban",
        {},
        "api_server",
    ) is False


def test_toggle_kanban_writes_only_the_selected_profiles_config(monkeypatch):
    config = {
        "toolsets": ["custom"],
        "platform_toolsets": {"api_server": ["web"]},
    }
    saved = {}
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [("kanban", "Task Board", "")],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: config)
    monkeypatch.setattr(
        tools_service,
        "_enabled_toolset_keys",
        lambda _config, _platform: {"web"},
    )
    monkeypatch.setattr(
        tools_service,
        "_save_platform_toolsets",
        lambda next_config, platform, enabled: saved.update(
            config=next_config,
            platform=platform,
            enabled=set(enabled),
        ),
    )

    result = tools_service.toggle_toolset("kanban", True)

    assert result == {
        "ok": True,
        "name": "kanban",
        "platform": "api_server",
        "enabled": True,
    }
    assert saved["platform"] == "api_server"
    assert saved["enabled"] == {"web", "kanban"}
    assert saved["config"]["toolsets"] == ["custom", "kanban"]


def test_toggle_kanban_off_removes_the_non_configurable_preserved_entry(
    monkeypatch,
):
    config = {
        "toolsets": ["custom", "kanban"],
        "platform_toolsets": {"api_server": ["web", "kanban"]},
    }
    saved = {}
    monkeypatch.setattr(
        tools_service,
        "_configurable_toolsets",
        lambda: [("kanban", "Task Board", "")],
    )
    monkeypatch.setattr(tools_service, "_load_config", lambda: config)
    monkeypatch.setattr(
        tools_service,
        "_enabled_toolset_keys",
        lambda _config, _platform: {"web", "kanban"},
    )
    monkeypatch.setattr(
        tools_service,
        "_save_platform_toolsets",
        lambda next_config, platform, enabled: saved.update(
            config=next_config,
            platform=platform,
            enabled=set(enabled),
        ),
    )

    tools_service.toggle_toolset("kanban", False)

    assert saved["enabled"] == {"web"}
    assert saved["config"]["toolsets"] == ["custom"]
    assert saved["config"]["platform_toolsets"]["api_server"] == ["web"]


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


def test_legacy_applets_config_is_migrated_to_extensions(monkeypatch):
    saved = {}
    config = {
        "mcp_servers": {
            "amiba-applets": {"url": "http://127.0.0.1:43123/mcp"},
            "docs": {"url": "https://example.com/mcp"},
        },
        "platform_toolsets": {
            "api_server": ["terminal", "applets", "amiba-applets"],
        },
    }
    monkeypatch.setattr(
        tools_service,
        "_save_config",
        lambda value: saved.update(value),
    )

    assert tools_service._migrate_legacy_extensions_config(config) is True
    assert config["mcp_servers"] == {
        "docs": {"url": "https://example.com/mcp"}
    }
    assert config["platform_toolsets"]["api_server"] == ["terminal", "extensions"]
    assert saved == config


def test_registered_mcp_connection_is_resolved_only_for_enabled_provider(monkeypatch):
    monkeypatch.setattr(
        tools_service,
        "_load_config",
        lambda: {
            "mcp_servers": {
                "docs": {
                    "command": "/usr/local/bin/docs-mcp",
                    "args": ["serve"],
                    "cwd": "/tmp/docs",
                    "env": {"DOCS_TOKEN": "secret"},
                    "enabled": True,
                },
                "off": {"url": "https://example.com/mcp", "enabled": False},
            }
        },
    )

    assert tools_service.get_installed_mcp_connection("docs") == {
        "providerId": "docs",
        "command": "/usr/local/bin/docs-mcp",
        "args": ["serve"],
        "cwd": "/tmp/docs",
        "env": {"DOCS_TOKEN": "secret"},
    }
    with pytest.raises(KeyError):
        tools_service.get_installed_mcp_connection("off")
    with pytest.raises(ValueError):
        tools_service.get_installed_mcp_connection("../../bad")
