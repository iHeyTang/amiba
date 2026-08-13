from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
import uuid
from functools import wraps
from typing import Any, Dict

from aiohttp import web

from ....adapters.hermes_core import hermes_home, hermes_profile_scope
from ....common import json_error, read_json_object


_PROVIDER_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_LOCK = threading.RLock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}


def _oauth_command(provider: str) -> list[str]:
    return [
        sys.executable,
        "-m",
        "hermes_cli.main",
        "auth",
        "add",
        provider,
        "--type",
        "oauth",
        "--no-browser",
    ]


def _snapshot(session_id: str) -> Dict[str, Any] | None:
    with _LOCK:
        session = _SESSIONS.get(session_id)
        if session is None:
            return None
        proc: subprocess.Popen = session["process"]
        code = proc.poll()
        return {
            "ok": True,
            "session_id": session_id,
            "provider": session["provider"],
            "running": code is None,
            "exit_code": code,
            "output": session["output"][-65536:],
            "started_at": session["started_at"],
        }


def _read_output(session_id: str) -> None:
    with _LOCK:
        session = _SESSIONS.get(session_id)
    if session is None:
        return
    stream = session["process"].stdout
    if stream is None:
        return
    for chunk in iter(lambda: stream.read(1), ""):
        if not chunk:
            break
        with _LOCK:
            current = _SESSIONS.get(session_id)
            if current is None:
                break
            current["output"] = (current["output"] + chunk)[-131072:]


async def handle_start(request: web.Request) -> web.Response:
    provider = request.match_info.get("provider", "").strip().lower()
    if not _PROVIDER_RE.match(provider):
        return json_error(400, "invalid provider")
    try:
        proc = subprocess.Popen(
            _oauth_command(provider),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={**os.environ, "HERMES_HOME": str(hermes_home()), "PYTHONUNBUFFERED": "1"},
        )
    except Exception as exc:
        return json_error(500, f"failed to start OAuth login: {exc}")
    session_id = uuid.uuid4().hex
    with _LOCK:
        _SESSIONS[session_id] = {"provider": provider, "process": proc, "output": "", "started_at": time.time()}
    threading.Thread(target=_read_output, args=(session_id,), daemon=True).start()
    return web.json_response(_snapshot(session_id))


async def handle_status(request: web.Request) -> web.Response:
    payload = _snapshot(request.match_info.get("session_id", ""))
    return web.json_response(payload) if payload else json_error(404, "OAuth session not found")


async def handle_input(request: web.Request) -> web.Response:
    session_id = request.match_info.get("session_id", "")
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    value = body.get("input")
    if not isinstance(value, str):
        return json_error(400, "input must be a string")
    with _LOCK:
        session = _SESSIONS.get(session_id)
    if session is None:
        return json_error(404, "OAuth session not found")
    proc: subprocess.Popen = session["process"]
    if proc.poll() is not None or proc.stdin is None:
        return json_error(409, "OAuth session is no longer running")
    try:
        proc.stdin.write(value + "\n")
        proc.stdin.flush()
    except OSError as exc:
        return json_error(500, str(exc))
    return web.json_response(_snapshot(session_id))


async def handle_cancel(request: web.Request) -> web.Response:
    session_id = request.match_info.get("session_id", "")
    with _LOCK:
        session = _SESSIONS.pop(session_id, None)
    if session is None:
        return json_error(404, "OAuth session not found")
    proc: subprocess.Popen = session["process"]
    if proc.poll() is None:
        proc.terminate()
    return web.json_response({"ok": True})


def _pool_summary(entry: Any, index: int) -> Dict[str, Any]:
    token = str(getattr(entry, "access_token", "") or "")
    return {
        "index": index,
        "id": getattr(entry, "id", None),
        "label": getattr(entry, "label", None),
        "auth_type": getattr(entry, "auth_type", None),
        "source": getattr(entry, "source", None),
        "priority": int(getattr(entry, "priority", 0) or 0),
        "last_status": getattr(entry, "last_status", None),
        "request_count": int(getattr(entry, "request_count", 0) or 0),
        "token_preview": f"…{token[-6:]}" if token else "",
        "has_refresh": bool(getattr(entry, "refresh_token", None)),
    }


async def handle_pool_list(request: web.Request) -> web.Response:
    try:
        from agent.credential_pool import load_pool
        from hermes_cli.auth import read_credential_pool

        requested = request.query.get("provider", "").strip().lower()
        provider_ids = [requested] if requested else sorted(read_credential_pool().keys())
        providers = []
        for provider in provider_ids:
            entries = load_pool(provider).entries()
            if entries or requested:
                providers.append({"provider": provider, "entries": [_pool_summary(entry, index) for index, entry in enumerate(entries, 1)]})
        return web.json_response({"ok": True, "providers": providers})
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_pool_add(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    provider = str(body.get("provider") or "").strip().lower()
    api_key = str(body.get("api_key") or "").strip()
    if not _PROVIDER_RE.match(provider) or not api_key:
        return json_error(400, "provider and api_key are required")
    try:
        from agent.credential_pool import AUTH_TYPE_API_KEY, PooledCredential, SOURCE_MANUAL, load_pool

        pool = load_pool(provider)
        pool.add_entry(PooledCredential(
            provider=provider,
            id=uuid.uuid4().hex[:6],
            label=str(body.get("label") or "").strip() or f"key #{len(pool.entries()) + 1}",
            auth_type=AUTH_TYPE_API_KEY,
            priority=int(body.get("priority") or 0),
            source=SOURCE_MANUAL,
            access_token=api_key,
        ))
        return web.json_response({"ok": True, "provider": provider, "count": len(pool.entries())})
    except Exception as exc:  # noqa: BLE001
        return json_error(400, str(exc))


async def handle_pool_remove(request: web.Request) -> web.Response:
    provider = request.match_info.get("provider", "").strip().lower()
    try:
        index = int(request.match_info.get("index", "0"))
        from agent.credential_pool import load_pool

        pool = load_pool(provider)
        removed = pool.remove_index(index)
        if removed is None:
            return json_error(404, "credential pool entry not found")
        try:
            from agent.credential_sources import find_removal_step
            from hermes_cli.auth import suppress_credential_source

            step = find_removal_step(provider, removed.source or "")
            if step is not None:
                result = step.remove_fn(provider, removed)
                if result.suppress:
                    suppress_credential_source(provider, removed.source)
        except Exception:
            pass
        return web.json_response({"ok": True, "provider": provider, "count": len(pool.entries())})
    except ValueError:
        return json_error(400, "invalid credential index")
    except Exception as exc:  # noqa: BLE001
        return json_error(400, str(exc))


def register_oauth_routes(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)
        return wrapped

    app.add_routes([
        web.post("/hermes/providers/oauth/{provider}/start", profiled(handle_start)),
        web.get("/hermes/providers/oauth/sessions/{session_id}", profiled(handle_status)),
        web.post("/hermes/providers/oauth/sessions/{session_id}/input", profiled(handle_input)),
        web.delete("/hermes/providers/oauth/sessions/{session_id}", profiled(handle_cancel)),
        web.get("/hermes/credentials/pool", profiled(handle_pool_list)),
        web.post("/hermes/credentials/pool", profiled(handle_pool_add)),
        web.delete("/hermes/credentials/pool/{provider}/{index}", profiled(handle_pool_remove)),
    ])
