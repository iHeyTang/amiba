"""
hermes-x-backplane — the local HTTP backend server for hermes-x desktop.

A **standalone HTTP server, NOT a hermes plugin.** Desktop spawns + supervises
it as a child process (desktop is the process supervisor). It is the single
front door on ``127.0.0.1:9394`` and fans out internally:

- ``/hermes/*``  — file-backed views/control over ``~/.hermes/`` (cron,
  sessions, model catalog, settings, memory, skills, plugins), built on
  hermes-agent's Python libraries. Needs the hermes-agent package importable;
  does NOT need a live agent.
- the **integrations gateway** — ``/integrations/<name>/search`` +
  ``/hermes/mention-resources`` + lifecycle admin. The integrations *framework*
  lives here now (``runtime/integrations/``): the backplane loads
  ``~/.hermes/integrations/`` at startup, serves the composer, and owns
  lifecycle. It used to be a separate ``hermes-x-plugin-integrations`` hermes
  plugin, but that plugin registered no agent tools — only the backplane ever
  read its registry — so it was a composer/backplane concern wearing a plugin
  costume, and moved in (see ``runtime/integrations/__init__.py``).
- ``/v1/*``  — reverse-proxied to the gateway (the hermes-agent runtime that
  actually runs chat / LLM / tools).

Run it::

    python -m hermes_x_backplane.server --port 9394   # or the
    hermes-x-backplane                                          # console script

It *used* to be loaded as a hermes plugin (``register(ctx)`` + ``plugin.yaml``)
purely to co-locate inside the gateway process — the only door into that
process was the plugin loader. With desktop supervising it directly, that
costume is gone: it's the honest server it always was.

A panic in a route handler is caught by aiohttp and returned as a 500.
"""

from __future__ import annotations
