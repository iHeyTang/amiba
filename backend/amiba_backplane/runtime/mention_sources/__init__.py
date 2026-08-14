"""Read-only compatibility loader for legacy composer mention sources.

A **mention source** is a package under ``~/.hermes/mention-sources/<name>/``
that lets the desktop composer @-mention an external system's resources. It
declares a ``search`` capability + a ``mention-source.yaml`` manifest (incl.
``mention_resources``) + an optional resolver skill under ``skills/``. It is
HTTP-agnostic domain logic — it never touches aiohttp.

This is NOT a hermes "integration" in hermes-agent's sense — real connectors
(agent actions, inbound triggers, auth) are hermes's own ``plugins`` / ``mcp`` /
``platforms``. A mention source only fills the gap hermes can't: feeding the
desktop composer's @-mention discovery (hermes has no UI). See the backend README.

- :mod:`loader`  — discover + import sources, expose ``search`` +
  ``mention_resources`` (read by the ``mention_sources_gateway`` HTTP routes).
- :mod:`skills`  — wire each source's resolver skill into the agent's
  ``skills.external_dirs``.

New @-mention capabilities are declared by an Extension manifest. This package is
kept only so existing installations continue to search and resolve their
already-installed sources while they migrate; it exposes no lifecycle API.
"""

from __future__ import annotations

from . import loader  # noqa: F401  (re-exported for the compatibility routes)
from .skills import wire_skills_dirs

__all__ = ["loader", "wire_skills_dirs", "load_all_and_wire"]


def load_all_and_wire():
    """Load every installed mention source into the registry, then wire their
    resolver skills into the agent config. Called once at backplane startup.
    """
    result = loader.load_all()
    wire_skills_dirs()
    return result
