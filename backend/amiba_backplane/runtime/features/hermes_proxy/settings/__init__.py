"""Hermes core settings — HTTP shims over Hermes Agent's own config surfaces.

The logically distinct read/write surfaces are grouped here because they
all wrap Hermes core state (``~/.hermes/config.yaml`` + adapters) and
share no client UI other than the options page:

- **Models** — provider catalog, per-provider model lists, main and
  auxiliary model selection (``model_routes``).
- **Providers** — provider credentials in the plugin's ``.env``
  (``model_routes``'s ``/hermes/provider-credentials`` endpoints,
  backed by ``provider_credentials_service``).
- **Skills** — Hermes skill discovery, file browser, enable/disable
  toggle (``skills_routes``).
- **Memory** — read-only view of curated ``MEMORY.md`` / ``USER.md``
  with the upstream threat scanner's verdict per entry (``memory_routes``).
- **Profiles** — Hermes-native profile, active-profile, role metadata, and
  ``SOUL.md`` management (``profiles_routes``).
- **Personalities** — read-only discovery of Hermes' temporary personality
  modes (``personalities_routes``).

Each sub-domain could later split into its own plugin; today they share
adapter imports (``hermes_agent_model``, ``hermes_core``, …) and the
umbrella keeps the wiring concise.
"""

from __future__ import annotations

from aiohttp import web

from .commands_routes import register_commands_routes
from .memory_routes import register_memory_routes
from .model_routes import register_model_routes
from .personalities_routes import register_personalities_routes
from .profiles_routes import register_profiles_routes
from .skills_routes import register_skills_routes
from .tools_routes import register_tools_routes


def register(app: web.Application) -> None:
    register_model_routes(app)
    register_memory_routes(app)
    register_skills_routes(app)
    register_tools_routes(app)
    register_commands_routes(app)
    register_personalities_routes(app)
    register_profiles_routes(app)


__all__ = ["register"]
