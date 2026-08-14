"""Build-time contract check for Amiba's native Hermes Extensions plugin."""

from __future__ import annotations

import os
import sys
from pathlib import Path


class _Context:
    def __init__(self) -> None:
        self.tools: list[dict] = []

    def register_tool(self, **definition) -> None:
        self.tools.append(definition)


def verify(source: Path) -> None:
    plugin = source / "plugins" / "amiba_extensions"
    assert (plugin / "plugin.yaml").is_file()
    assert "kind: backend" in (plugin / "plugin.yaml").read_text(encoding="utf-8")

    sys.path.insert(0, str(source))
    os.environ.pop("AMIBA_EXTENSIONS_BRIDGE_URL", None)
    os.environ.pop("AMIBA_EXTENSIONS_BRIDGE_TOKEN", None)
    from plugins.amiba_extensions import register

    context = _Context()
    register(context)
    registered = {tool["name"]: tool for tool in context.tools}
    expected = {
        "amiba_create_extension",
        "amiba_update_extension",
        "amiba_preview_extension_draft",
        "amiba_get_extension_status",
        "amiba_list_extensions",
        "amiba_cancel_extension_operation",
        "amiba_list_extension_resources",
        "amiba_read_extension_resource",
    }
    assert expected <= registered.keys()
    assert all(registered[name]["toolset"] == "extensions" for name in expected)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_amiba_extensions_plugin.py <patched-hermes-source>")
    verify(Path(sys.argv[1]).resolve())
