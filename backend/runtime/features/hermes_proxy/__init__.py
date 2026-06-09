"""HTTP wrappers around Hermes core APIs the gateway doesn't expose.

Sub-modules:
- ``cron``: ``/hermes/cron/*`` — wraps Hermes's cron module
- ``settings``: ``/hermes/model/info``, ``/hermes/model/auxiliary``,
  ``/hermes/model/options``, ``/hermes/model/set``,
  ``/hermes/provider-models``, ``/hermes/provider-credentials``,
  ``/hermes/memories``, ``/hermes/skills``
- ``sessions``: ``/hermes/sessions/*`` — read-only view over
  ``hermes_state.SessionDB`` (the canonical conversation log)
- ``attachments``: ``/hermes/attachments*`` — upload/delete conversation
  attachments, persisted under
  ``<hermes_home>/hermes-x/inbox/<session>/``
- ``integrations_gateway``: HTTP adapter over the ``hermes-x-plugin-
  integrations`` registry — ``/integrations/<name>/search`` (calls the
  integration's in-process ``search`` capability), ``/hermes/mention-
  resources`` (flattened registry for the composer), and ``/hermes/
  integrations*`` lifecycle admin (delegates to the integrations plugin's
  manager). Degrades gracefully if that plugin isn't installed.
- ``turn_metadata``: ``/hermes/turn-metadata`` — small in-memory TTL
  store for per-turn snapshots (browser tab freeze, etc.) that the
  agent's tool handlers fetch over loopback. Keeps out-of-band turn
  state out of the prompt while staying decoupled from hermes-agent.

These wrap ``hermes_state`` / ``cron.jobs`` etc. as Python libraries
directly. That makes them available whenever the backplane is loaded —
unlike the dashboard's ``/api/*`` FastAPI app, which only runs while
the user has ``hermes dashboard`` open. When the gateway grows native
HTTP routes for these, the proxy modules become redundant and can be
retired.
"""

from __future__ import annotations

from aiohttp import web

from . import (
    attachments,
    cron,
    integrations_gateway,
    lifecycle,
    logs,
    plugins_routes,
    sessions,
    settings,
    stt,
    turn_metadata,
)


def register(app: web.Application) -> None:
    """Register all hermes_proxy routes onto *app*."""
    cron.register(app)
    settings.register(app)
    sessions.register(app)
    attachments.register(app)
    integrations_gateway.register(app)
    plugins_routes.register(app)
    lifecycle.register(app)
    logs.register(app)
    stt.register(app)
    turn_metadata.register(app)
