"""The integrations framework — now owned by the backplane, not a hermes plugin.

An *integration* is a package under ``~/.hermes/integrations/<name>/`` that
declares a ``search`` capability + an ``integration.yaml`` manifest (incl.
``mention_resources``) + an optional resolver skill under ``skills/``. It is
HTTP-agnostic domain logic — it never touches aiohttp.

This used to live in the standalone ``hermes-x-plugin-integrations`` hermes
plugin, but that plugin registered **no agent tools and no hooks** — its registry
was only ever read by the backplane (in a *different* process, so it couldn't
even share the plugin's in-process copy). It was a composer/backplane concern
wearing a plugin costume, so it now lives where it's actually consumed:

- :mod:`loader`  — discover + import integrations, expose ``search`` +
  ``mention_resources`` (read by the ``integrations_gateway`` HTTP routes).
- :mod:`manager` — lifecycle (list / install / remove / reload), driven by the
  backplane's ``/hermes/integrations*`` admin routes (desktop UI calls them).
- :mod:`skills`  — wire each integration's resolver skill into the agent's
  ``skills.external_dirs``.

Distribution: integrations are still independent packages installed into
``~/.hermes/integrations/`` (via ``manager.install`` from git/path) — the
*framework* moved into the backplane; the *integrations* stay pluggable.
"""

from __future__ import annotations

from . import loader, manager  # noqa: F401  (re-exported for the HTTP routes)
from .skills import wire_skills_dirs

__all__ = ["loader", "manager", "wire_skills_dirs", "load_all_and_wire"]


def load_all_and_wire():
    """Load every installed integration into the registry, then wire their
    resolver skills into the agent config. Called once at backplane startup.
    """
    result = loader.load_all()
    wire_skills_dirs()
    return result
