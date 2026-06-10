"""HTTP routes for the turn-metadata side-channel.

``POST /hermes/turn-metadata`` — store a snapshot for a session_key.
``GET  /hermes/turn-metadata?session_key=...`` — fetch the stored snapshot.

The PUT-then-read flow is decoupled by design: the browser extension
PUTs the snapshot before submitting the chat request, and the agent's
tool handlers GET it on demand. Keeps the two sides from needing to
share a process-local module or a thread-local — only HTTP and a
``session_key`` string flow between them.

Auth: covered by the backplane's :mod:`runtime.auth` middleware. Both
endpoints sit behind the same Bearer key as everything else under
``/hermes/*``.
"""

from __future__ import annotations

from aiohttp import web

from ....common import json_error, read_json_object
from .service import get as service_get
from .service import put as service_put

# 64 KB is overkill for any realistic snapshot (tab url + title +
# trimmed page text + ids), but well below the backplane's general
# request cap. Picking a per-route limit keeps memory accidents (bad
# extension PUTs a 10 MB blob) bounded without needing to retune
# ``client_max_size`` globally.
_MAX_PAYLOAD_BYTES = 64 * 1024


async def _handle_put(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request, max_bytes=_MAX_PAYLOAD_BYTES)
    except web.HTTPBadRequest as exc:
        return exc

    session_key = body.get("session_key")
    if not isinstance(session_key, str) or not session_key.strip():
        return json_error(400, "session_key is required (non-empty string)")

    metadata = body.get("metadata")
    if not isinstance(metadata, dict):
        return json_error(400, "metadata is required (object)")

    # Optional client-supplied TTL override, useful for very long-running
    # tool sequences (Playwright crawls, etc.). Clamped to a hard ceiling
    # so a buggy caller can't pin a snapshot forever.
    ttl_raw = body.get("ttl")
    if ttl_raw is None:
        service_put(session_key.strip(), metadata)
    else:
        try:
            ttl = float(ttl_raw)
        except (TypeError, ValueError):
            return json_error(400, "ttl must be a number (seconds)")
        ttl = max(0.0, min(ttl, 600.0))  # 0–10 minutes
        service_put(session_key.strip(), metadata, ttl=ttl)

    return web.json_response({"ok": True}, status=200)


async def _handle_get(request: web.Request) -> web.Response:
    session_key = request.query.get("session_key", "").strip()
    if not session_key:
        return json_error(400, "session_key query parameter is required")
    payload = service_get(session_key)
    if payload is None:
        # 404 (not 200 with null) so tool handlers can short-circuit on
        # status alone without parsing the body.
        return json_error(404, "no metadata for session_key")
    return web.json_response({"ok": True, "metadata": payload})


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.post("/hermes/turn-metadata", _handle_put),
            web.get("/hermes/turn-metadata", _handle_get),
        ]
    )
