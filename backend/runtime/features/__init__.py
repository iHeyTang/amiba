"""Feature modules that compose the backplane's HTTP surface.

All routes live under the ``hermes_proxy`` lane — thin HTTP wrappers over
Hermes core APIs (cron, sessions, model catalog, provider settings, memory,
skills, attachment uploads) that the gateway doesn't expose itself, mounted at
``/hermes/*``, plus the ``mention_sources_gateway`` adapter that serves
``/mention-sources/<name>/search`` + ``/hermes/mention-resources`` + lifecycle
admin by reading the mention-source registry in-process. The framework itself
(loader / manager / skills wiring) lives in ``runtime/mention_sources/``; this
lane just adapts its ``search`` capability to HTTP.
"""

from __future__ import annotations

from aiohttp import web

from . import hermes_proxy


def register_native(app: web.Application) -> None:
    """Register the native hermes_proxy lane."""
    hermes_proxy.register(app)
