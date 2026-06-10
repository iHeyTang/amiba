"""Turn-scoped metadata side-channel.

Browser extensions (and any other surface that has out-of-band state the
agent shouldn't see in the prompt but the tool layer needs to act on)
PUT a small per-turn snapshot here keyed by ``session_key``. Tool
handlers running inside the hermes-agent executor look it up via the
HTTP loopback and apply it.

The canonical user is the browser-extension "frozen active tab"
snapshot — the agent's ``my_browser_active_tab`` tool wants to return
the tab the user was looking at when they hit send, not whatever they
happen to be on three steps into the turn. Keeping the snapshot
out-of-band keeps the model from being prompt-poisoned by the captured
URL / page text while still letting the tool reach for it.

Standalone-extractable: depends only on stdlib + aiohttp.
"""

from __future__ import annotations

from .routes import register

__all__ = ["register"]
