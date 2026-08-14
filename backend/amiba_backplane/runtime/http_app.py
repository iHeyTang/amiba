"""HTTP application factory.

Composes the backplane's HTTP surface from native feature lanes (under
``runtime/features``), including the ``mention_sources_gateway`` adapter that
serves ``/mention-sources/<name>/search`` + ``/hermes/mention-resources``.
"""

from __future__ import annotations

from aiohttp import web

from .auth import auth_middleware
from .common import json_error
from .features import register_native
from .features.gateway_proxy import register as register_gateway_proxy
from .features.hermes_proxy.attachments.routes import max_client_size_bytes
from .hermes_compatibility import (
    hermes_compatibility_middleware,
    hermes_compatibility_status,
)
from .protocol import PROTOCOL_VERSION


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as exc:
            if exc.content_type == "application/json":
                resp = exc
            else:
                resp = json_error(exc.status, exc.reason)

    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Max-Age"] = "86400"
    return resp


def _version() -> str:
    try:
        from importlib.metadata import version

        return version("amiba-backplane")
    except Exception:
        return "unknown"


async def _health_handler(_req: web.Request) -> web.Response:
    compatibility = hermes_compatibility_status()
    return web.json_response(
        {
            "ok": True,
            "plugin_version": _version(),
            "protocol_version": PROTOCOL_VERSION,
            **compatibility,
        }
    )


def build_http_app() -> web.Application:
    # Middleware stack runs outermost-first: cors wraps auth wraps the
    # handler. That order matters — CORS headers must be added to 401
    # responses too, otherwise the browser swallows them and the
    # extension can't tell auth failure apart from network failure.
    app = web.Application(
        middlewares=[
            cors_middleware,
            auth_middleware,
            hermes_compatibility_middleware,
        ],
        client_max_size=max_client_size_bytes(),
    )
    # /health is exempt from auth (see runtime.auth._AUTH_EXEMPT_PATHS)
    # so the onboarding gate can probe liveness without a key.
    app.router.add_get("/health", _health_handler)
    register_native(app)
    register_gateway_proxy(app)
    # Legacy ``/mention-sources/<name>/search`` +
    # ``/hermes/mention-resources`` are served read-only by the hermes_proxy
    # compatibility adapter. New mention capabilities belong to Extensions.
    app.router.add_route(
        "OPTIONS", "/{path_info:.*}", lambda _req: web.Response(status=204)
    )
    return app
