"""Profile-scoped Hermes approval-mode settings routes."""

from __future__ import annotations

from functools import wraps

from aiohttp import web

from ....adapters.hermes_core import current_profile_id, hermes_profile_scope
from ....common import json_error, read_json_object

VALID_APPROVAL_MODES = {"manual", "smart", "off"}


def _run_approval_mode(requested_mode: str | None):
    """Use Hermes's canonical resolver and managed-config write boundary."""
    from hermes_cli.approval_mode import run_approval_mode_command  # type: ignore

    return run_approval_mode_command(requested_mode)


async def handle_approval_mode_get(_request: web.Request) -> web.Response:
    try:
        result = _run_approval_mode(None)
    except Exception as exc:
        return json_error(500, f"failed to read approval mode: {exc}")
    if not result.ok:
        return json_error(500, result.message)
    return web.json_response(
        {
            "ok": True,
            "mode": result.mode,
            "profile": current_profile_id(),
        }
    )


async def handle_approval_mode_put(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc

    mode = str(body.get("mode") or "").strip().lower()
    if mode not in VALID_APPROVAL_MODES:
        return json_error(400, "mode must be one of: manual, smart, off")

    try:
        result = _run_approval_mode(mode)
    except Exception as exc:
        return json_error(500, f"failed to save approval mode: {exc}")
    if not result.ok:
        return json_error(409, result.message)
    return web.json_response(
        {
            "ok": True,
            "mode": result.mode,
            "profile": current_profile_id(),
            "changed": result.changed,
        }
    )


def register_approvals_routes(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            try:
                with hermes_profile_scope(request.query.get("profile")):
                    return await handler(request)
            except FileNotFoundError as exc:
                return json_error(404, str(exc))
            except ValueError as exc:
                return json_error(400, str(exc))

        return wrapped

    app.add_routes(
        [
            web.get("/hermes/approvals/mode", profiled(handle_approval_mode_get)),
            web.put("/hermes/approvals/mode", profiled(handle_approval_mode_put)),
        ]
    )


__all__ = ["register_approvals_routes"]
