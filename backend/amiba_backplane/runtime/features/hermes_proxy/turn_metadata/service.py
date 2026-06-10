"""In-memory TTL store for turn-scoped metadata.

A single ``session_key -> (payload, expires_at)`` dict. The HTTP routes
:func:`put` from ``POST`` and :func:`get` from ``GET``; tool handlers
on the hermes-agent side read via the GET endpoint over loopback.

TTL exists to bound memory if the consumer never reads (e.g. the
extension PUTs a snapshot but the agent never invokes a tool that
needs it). Sixty seconds is comfortably longer than a typical turn —
agent turns wrap within a few seconds even on slow models, and the key
gets overwritten on the next turn anyway, so the practical concern is
"clean up stragglers after process idle", not "support multi-minute
turns".

Single asyncio loop, no thread sharing — backplane handlers all run on
the aiohttp event loop, so no lock is needed for the dict itself.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

# session_key -> (payload, monotonic_expiry)
_store: Dict[str, Tuple[Dict[str, Any], float]] = {}

# How long a stored snapshot stays addressable. Generous so a delayed
# tool dispatch on a slow model doesn't lose it; small enough to bound
# memory if the consumer never reads.
DEFAULT_TTL_SECONDS = 60.0

# Sweep-on-write threshold: if the store grows past this many entries we
# do a synchronous purge of expired rows. The expected steady state is
# 1–2 entries (active turn per session), so this only kicks in if a
# pathological client floods PUTs without overwriting the same key.
_SWEEP_THRESHOLD = 64


def _now() -> float:
    return time.monotonic()


def _sweep_expired(now: Optional[float] = None) -> None:
    """Drop expired rows. Cheap when the store is small."""
    cutoff = _now() if now is None else now
    expired = [k for k, (_, exp) in _store.items() if exp <= cutoff]
    for k in expired:
        _store.pop(k, None)


def put(session_key: str, payload: Dict[str, Any], ttl: float = DEFAULT_TTL_SECONDS) -> None:
    """Store *payload* under *session_key* with *ttl* seconds of validity.

    Overwrites any prior value for the same key — the contract is
    "latest write per turn wins", and the extension is expected to PUT
    once per user submit.
    """
    if not session_key:
        return
    if not isinstance(payload, dict):
        return
    if len(_store) > _SWEEP_THRESHOLD:
        _sweep_expired()
    _store[session_key] = (payload, _now() + max(ttl, 0.0))


def get(session_key: str) -> Optional[Dict[str, Any]]:
    """Return the payload for *session_key*, or ``None`` if missing/expired.

    Does NOT consume the entry — a single turn can call multiple tools
    that all want the same snapshot. Cleanup is TTL-driven so we don't
    have to model "tool stopped reading" explicitly.
    """
    if not session_key:
        return None
    entry = _store.get(session_key)
    if entry is None:
        return None
    payload, expires_at = entry
    if expires_at <= _now():
        _store.pop(session_key, None)
        return None
    return payload


def drop(session_key: str) -> None:
    """Force-evict *session_key*. Used by tests and by callers that want
    to mark a turn as fully consumed."""
    _store.pop(session_key, None)


def clear() -> None:
    """Drop everything. Used by tests."""
    _store.clear()
