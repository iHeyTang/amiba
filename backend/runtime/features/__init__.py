"""Feature modules that compose the backplane's HTTP surface.

All routes live under the ``hermes_proxy`` lane — thin HTTP wrappers over
Hermes core APIs (cron, sessions, model catalog, provider settings, memory,
skills, attachment uploads) that the gateway doesn't expose itself, mounted at
``/hermes/*``, plus the ``integrations_gateway`` adapter that serves
``/integrations/<name>/search`` + ``/hermes/mention-resources`` + lifecycle
admin by reading the separately-installed ``hermes-x-plugin-integrations``
registry in-process. The integration framework itself (loader / manager /
``hermes integration`` CLI) lives in that plugin, not here — the backplane
only adapts its capabilities to HTTP.
"""

from __future__ import annotations

from aiohttp import web

from . import hermes_proxy


def register_native(app: web.Application) -> None:
    """Register the native hermes_proxy lane."""
    hermes_proxy.register(app)
