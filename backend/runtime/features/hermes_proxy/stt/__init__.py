"""``/hermes/stt`` — speech-to-text routes for the desktop voice composer.

A thin wrapper around ``hermes_agent.tools.transcription_tools`` so the
desktop's microphone button can transcribe audio without the renderer
needing to know which STT backend the user has configured. Provider /
model / API key choices live in ``~/.hermes/config.yaml`` and
``~/.hermes/.env`` exactly as for the CLI — this endpoint just forwards
the audio.

Routes:
  POST /hermes/stt          — transcribe an uploaded audio clip
  GET  /hermes/stt/status   — return effective STT config (enabled,
                              resolved provider, model). Used by the
                              Voice settings page to surface which
                              backend will run.
"""

from __future__ import annotations

from aiohttp import web

from . import routes


def register(app: web.Application) -> None:
    routes.register(app)
