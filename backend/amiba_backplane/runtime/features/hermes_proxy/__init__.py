"""HTTP wrappers around Hermes core APIs the gateway doesn't expose.

Sub-modules:
- ``cron``: ``/hermes/cron/*`` — wraps Hermes's cron module
- ``kanban``: ``/hermes/kanban/*`` — reads Hermes boards and session-linked
  tasks and creates tasks in the canonical Kanban database
- ``settings``: ``/hermes/model/info``, ``/hermes/model/auxiliary``,
  ``/hermes/model/options``, ``/hermes/model/set``,
  ``/hermes/provider-models``, ``/hermes/provider-credentials``,
  ``/hermes/memories``, ``/hermes/skills``
- ``sessions``: ``/hermes/sessions/*`` — read-only view over
  ``hermes_state.SessionDB`` (the canonical conversation log)
- ``attachments``: ``/hermes/attachments*`` — upload/delete conversation
  attachments, persisted under
  ``<hermes_home>/amiba/inbox/<session>/``
- ``mention_sources_gateway``: HTTP adapter over the mention-source registry
  (``runtime/mention_sources``) — ``/mention-sources/<name>/search`` (calls the
  source's in-process ``search`` capability), ``/hermes/mention-resources``
  (flattened registry for the composer). This is a read-only compatibility
  adapter for sources installed before mentions became Extension capabilities.
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
    kanban,
    mention_sources_gateway,
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
    kanban.register(app)
    settings.register(app)
    sessions.register(app)
    attachments.register(app)
    mention_sources_gateway.register(app)
    plugins_routes.register(app)
    lifecycle.register(app)
    logs.register(app)
    stt.register(app)
    turn_metadata.register(app)
