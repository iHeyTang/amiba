"""Search implementation for the {{NAME}} mention source.

``search(rtype, query, limit)`` is the ONLY thing you must implement. It returns
``{"ok": bool, "items": [{"id", "title", "detail", "payload"}]}``. ``payload``
must carry every field your manifest's ``mention_resources[].fields`` lists — the
composer interpolates them into the ``serialize`` template to build the handle.

HTTP-agnostic: pure domain logic. Never import aiohttp. Search your external
system however you like — an HTTP call, an SDK, or shelling out to a CLI.
"""

from __future__ import annotations

from typing import Any, Dict, List


async def search(rtype: str, query: str, limit: int = 8) -> Dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"ok": True, "items": []}

    if rtype == "thing":
        rows = await _search_things(query, limit)
        return {
            "ok": True,
            "items": [
                {
                    "id": r["id"],                    # stable unique id
                    "title": r["title"],              # main text in the @ menu
                    "detail": r.get("detail", ""),    # secondary grey text
                    # payload keys must be a superset of the manifest `fields`:
                    "payload": {"id": r["id"], "title": r["title"]},
                }
                for r in rows
            ],
        }

    # Unknown type → empty. NEVER raise: the composer just shows no candidates.
    return {"ok": True, "items": []}


async def _search_things(query: str, limit: int) -> List[Dict[str, Any]]:
    # TODO: replace with a real lookup against {{NAME}} for `query`, max `limit`.
    return []
