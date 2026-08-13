from amiba_backplane.runtime.features.hermes_proxy.settings.oauth_routes import (
    _oauth_command,
)


def test_oauth_command_uses_supported_interactive_auth_flow():
    command = _oauth_command("openai-codex")

    assert command[1:5] == ["-m", "hermes_cli.main", "auth", "add"]
    assert command[5:] == [
        "openai-codex",
        "--type",
        "oauth",
        "--no-browser",
    ]
