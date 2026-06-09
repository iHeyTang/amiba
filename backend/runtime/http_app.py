"""HTTP application factory.

Composes the backplane's HTTP surface from native feature lanes plus a
single catch-all dispatcher for ``/integrations/<name>/*``. The
dispatcher reads a runtime-mutable registry (see :mod:`runtime.api`),
so register / replace / remove on integrations works at any time —
boot, mid-flight, or post-tool-call — without re-touching the aiohttp
Application.
"""

from __future__ import annotations

from aiohttp import web

from .auth import auth_middleware
from .common import json_error
from .features import register_native
from .features.gateway_proxy import register as register_gateway_proxy
from .features.hermes_proxy.attachments.routes import max_client_size_bytes
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

        return version("hermes-x-backplane")
    except Exception:
        return "unknown"


async def _health_handler(_req: web.Request) -> web.Response:
    return web.json_response(
        {
            "ok": True,
            "plugin_version": _version(),
            "protocol_version": PROTOCOL_VERSION,
        }
    )


def build_http_app() -> web.Application:
    # Middleware stack runs outermost-first: cors wraps auth wraps the
    # handler. That order matters — CORS headers must be added to 401
    # responses too, otherwise the browser swallows them and the
    # extension can't tell auth failure apart from network failure.
    app = web.Application(
        middlewares=[cors_middleware, auth_middleware],
        client_max_size=max_client_size_bytes(),
    )
    # /health is exempt from auth (see runtime.auth._AUTH_EXEMPT_PATHS)
    # so the onboarding gate can probe liveness without a key.
    app.router.add_get("/health", _health_handler)
    register_native(app)
    register_gateway_proxy(app)
    # ``/integrations/<name>/search`` + ``/hermes/mention-resources`` +
    # lifecycle admin are served by the hermes_proxy ``integrations_gateway``
    # adapter, which reads the (separately-installed) hermes-x-plugin-
    # integrations registry in-process. No catch-all dispatcher and no
    # integration loading happen here — integrations are loaded by their own
    # plugin; the backplane only adapts them to HTTP.
    app.router.add_route(
        "OPTIONS", "/{path_info:.*}", lambda _req: web.Response(status=204)
    )
    return app
