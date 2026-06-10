from amiba_backplane.runtime.features.hermes_proxy.settings.commands_service import (
    list_commands_response,
)


def test_returns_list_of_dicts_with_expected_fields():
    cmds = list_commands_response()
    assert isinstance(cmds, list)
    assert cmds, "expected at least one command"
    sample = cmds[0]
    for key in ("name", "description", "category", "aliases", "args_hint", "subcommands"):
        assert key in sample


def test_excludes_cli_only_and_messaging_only_commands():
    names = {c["name"] for c in list_commands_response()}
    # cli_only commands must not leak to web/desktop
    assert "clear" not in names      # cli_only
    assert "config" not in names     # cli_only
    # messaging-platform-only commands excluded explicitly
    assert "start" not in names
    assert "approve" not in names
    assert "sethome" not in names


def test_includes_everywhere_commands():
    names = {c["name"] for c in list_commands_response()}
    assert "new" in names
    assert "model" in names
    assert "status" in names
