"""Serialize hermes_cli COMMAND_REGISTRY for web/desktop clients.

Single source of truth: hermes_cli.commands.COMMAND_REGISTRY (same data the
CLI and gateways use). We expose only commands meaningful to a non-CLI HTTP
client, reusing the registry's own gateway-availability rule and dropping the
handful of commands that only make sense on messaging platforms.
"""
from __future__ import annotations

from typing import Any, Dict, List

# Commands that are only meaningful on messaging platforms (Telegram/Slack/...),
# not in a web/desktop chat surface. Dropped from the web command list.
_MESSAGING_ONLY = {"start", "topic", "approve", "deny", "sethome"}


def list_commands_response() -> List[Dict[str, Any]]:
    from hermes_cli.commands import COMMAND_REGISTRY, _is_gateway_available

    out: List[Dict[str, Any]] = []
    for cmd in COMMAND_REGISTRY:
        if not _is_gateway_available(cmd):
            continue
        if cmd.name in _MESSAGING_ONLY:
            continue
        out.append(
            {
                "name": cmd.name,
                "description": cmd.description,
                "category": cmd.category,
                "aliases": list(cmd.aliases),
                "args_hint": cmd.args_hint,
                "subcommands": list(cmd.subcommands),
            }
        )
    return out
