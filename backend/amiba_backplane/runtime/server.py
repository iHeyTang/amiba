"""
Backplane HTTP server — the launch entry point.

This is THE way to run the backplane (it is a standalone server, not a hermes
plugin). Desktop spawns + supervises it::

    python -m amiba_backplane.server --port 9394   # or the
    amiba-backplane                                          # console script

Lanes (see ``features/__init__.py``):
- ``/hermes/*``     — file-backed views over ``~/.hermes/`` (hermes-agent libs)
- legacy ``/mention-sources/{name}/search`` + ``/hermes/mention-resources``
- ``/v1/*``         — reverse-proxied to the gateway (chat / LLM / tools)
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from aiohttp import web

from .http_app import build_http_app

logger = logging.getLogger(__name__)


def _load_mention_sources() -> None:
    """Load legacy mention sources + wire their resolver skills.

    New mention capabilities belong to Extensions. We still load
    ``~/.hermes/mention-sources/`` here so ``/mention-sources/*`` +
    ``/hermes/mention-resources`` keep working for existing users, and wire
    each source's resolver skill. A failure degrades to an empty registry.
    """
    try:
        from .mention_sources import load_all_and_wire

        result = load_all_and_wire()
        logger.info(
            "mention sources loaded: %d ok, %d failed",
            len(result.loaded), len(result.failed),
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("mention sources not loaded: %s", exc)


async def _main(port: int) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    _load_mention_sources()

    app = build_http_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    logger.info(
        "amiba-backplane HTTP on http://127.0.0.1:%d — "
        "/hermes/*, /mention-sources/{name}/search, /v1/* (-> gateway)",
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
    parser = argparse.ArgumentParser(description="amiba-backplane HTTP server")
    parser.add_argument("--port", type=int, default=9394, help="HTTP listen port")
    args = parser.parse_args()
    asyncio.run(_main(args.port))


if __name__ == "__main__":
    main()
