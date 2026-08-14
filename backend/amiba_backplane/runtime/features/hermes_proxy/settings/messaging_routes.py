from __future__ import annotations

import asyncio
from functools import wraps

from aiohttp import web

from ....adapters.dotenv_local import plugin_dotenv_path
from ....adapters.hermes_core import hermes_profile_scope
from ....common import json_error, read_json_object
from ..lifecycle.service import status_response
from .messaging_service import (
    approve_pairing,
    create_webhook,
    list_pairings,
    list_platforms,
    list_webhooks,
    mutate_webhook,
    revoke_pairing,
    save_platform,
)


async def handle_platforms(_request: web.Request) -> web.Response:
    status = await status_response()
    return web.json_response(
        {
            "ok": True,
            "env_path": str(plugin_dotenv_path()),
            "gateway_running": status.get("gateway_running") is True,
            "gateway_state": status.get("gateway_state"),
            "platforms": list_platforms(
                status.get("gateway_platforms"),
                gateway_running=status.get("gateway_running") is True,
                gateway_state=str(status.get("gateway_state") or "") or None,
                gateway_error=(
                    str(status.get("gateway_exit_reason") or "") or None
                ),
            ),
        }
    )


async def handle_save_platform(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        payload = await asyncio.to_thread(save_platform, request.match_info.get("platform", ""), body)
    except web.HTTPBadRequest as exc:
        return exc
    except KeyError:
        return json_error(404, "unknown messaging platform")
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_test_platform(request: web.Request) -> web.Response:
    platform_id = request.match_info.get("platform", "")
    status = await status_response()
    rows = list_platforms(
        status.get("gateway_platforms"),
        gateway_running=status.get("gateway_running") is True,
        gateway_state=str(status.get("gateway_state") or "") or None,
        gateway_error=str(status.get("gateway_exit_reason") or "") or None,
    )
    row = next((item for item in rows if item["id"] == platform_id), None)
    if row is None:
        return json_error(404, "unknown messaging platform")
    ok = bool(row["enabled"] and row["configured"] and row["state"] == "connected")
    if ok:
        message = f"{row['name']} is connected."
    elif not row["enabled"]:
        message = f"{row['name']} is disabled. Enable it and try again."
    elif not row["configured"]:
        missing = [
            field["label"]
            for field in row["fields"]
            if field["required"] and not field["configured"]
        ]
        message = (
            f"Missing required setup: {', '.join(missing)}"
            if missing
            else "Channel setup is incomplete."
        )
    elif not row["gateway_running"]:
        message = "Gateway is not running. Restart it and try again."
    else:
        message = row.get("error") or "The gateway has not reported a connection yet."
    return web.json_response(
        {"ok": ok, "state": row["state"], "message": message},
        status=200 if ok else 400,
    )


async def handle_pairings(_request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(list_pairings))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_pairing_action(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        platform = str(body.get("platform") or "").strip().lower()
        if request.match_info.get("action") == "approve":
            payload = await asyncio.to_thread(approve_pairing, platform, str(body.get("target") or ""))
        else:
            payload = await asyncio.to_thread(revoke_pairing, platform, str(body.get("user_id") or ""))
    except web.HTTPBadRequest as exc:
        return exc
    except KeyError:
        return json_error(404, "pairing entry not found or expired")
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


async def handle_webhooks(_request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(list_webhooks))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_create_webhook(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
        return web.json_response(await asyncio.to_thread(create_webhook, body))
    except web.HTTPBadRequest as exc:
        return exc
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))


async def handle_mutate_webhook(request: web.Request) -> web.Response:
    try:
        if request.method == "DELETE":
            payload = await asyncio.to_thread(mutate_webhook, request.match_info.get("name", ""), remove=True)
        else:
            body = await read_json_object(request)
            payload = await asyncio.to_thread(
                mutate_webhook,
                request.match_info.get("name", ""),
                updates=body,
            )
    except web.HTTPBadRequest as exc:
        return exc
    except KeyError:
        return json_error(404, "webhook not found")
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_messaging_routes(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)
        return wrapped

    app.add_routes([
        web.get("/hermes/messaging/platforms", profiled(handle_platforms)),
        web.put("/hermes/messaging/platforms/{platform}", profiled(handle_save_platform)),
        web.post("/hermes/messaging/platforms/{platform}/test", profiled(handle_test_platform)),
        web.get("/hermes/messaging/pairings", profiled(handle_pairings)),
        web.post("/hermes/messaging/pairings/{action}", profiled(handle_pairing_action)),
        web.get("/hermes/messaging/webhooks", profiled(handle_webhooks)),
        web.post("/hermes/messaging/webhooks", profiled(handle_create_webhook)),
        web.put("/hermes/messaging/webhooks/{name}", profiled(handle_mutate_webhook)),
        web.delete("/hermes/messaging/webhooks/{name}", profiled(handle_mutate_webhook)),
    ])
