"""
Backplane HTTP server — the launch entry point.

This is THE way to run the backplane (it is a standalone server, not a hermes
plugin). Desktop spawns + supervises it::

    python -m hermes_x_backplane.server --port 9394   # or the
    hermes-x-backplane                                          # console script

Lanes (see ``features/__init__.py``):
- ``/hermes/*``     — file-backed views over ``~/.hermes/`` (hermes-agent libs)
- ``/integrations/{name}/search`` + ``/hermes/mention-resources`` + admin
- ``/v1/*``         — reverse-proxied to the gateway (chat / LLM / tools)
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from aiohttp import web

from .http_app import build_http_app

logger = logging.getLogger(__name__)


def _load_integrations() -> None:
    """Load integrations + wire their resolver skills.

    The integrations framework is owned by the backplane now (see
    :mod:`hermes_x_backplane.runtime.integrations`) — it is no longer a hermes
    plugin. We load ``~/.hermes/integrations/`` here so ``/integrations/*`` +
    ``/hermes/mention-resources`` work, and wire each integration's ``skills/``
    into the agent config. A failure degrades to an empty registry; the rest of
    the server is unaffected.
    """
    try:
        from .integrations import load_all_and_wire

        result = load_all_and_wire()
        logger.info(
            "integrations loaded: %d ok, %d failed",
            len(result.loaded), len(result.failed),
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("integrations not loaded: %s", exc)


async def _main(port: int) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    _load_integrations()

    app = build_http_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    logger.info(
        "hermes-x-backplane HTTP on http://127.0.0.1:%d — "
        "/hermes/*, /integrations/{name}/search, /v1/* (-> gateway)",
        port,
    )

    try:
        await asyncio.Future()  # run forever
    finally:
        await runner.cleanup()


def main() -> None:
    try:
        from .adapters.dotenv_local import apply_plugin_dotenv

        apply_plugin_dotenv()
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="hermes-x-backplane HTTP server")
    parser.add_argument("--port", type=int, default=9394, help="HTTP listen port")
    args = parser.parse_args()
    asyncio.run(_main(args.port))


if __name__ == "__main__":
    main()
