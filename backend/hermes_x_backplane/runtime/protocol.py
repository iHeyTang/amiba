"""Backplane protocol constants.

This module is the single source of truth for the backplane HTTP/WS
contract version. Import ``PROTOCOL_VERSION`` from here wherever the
version needs to be surfaced (e.g. /health, /hermes/status).
"""

from __future__ import annotations

# Backplane HTTP/WS contract version.
# Bump on ANY breaking change to /v1/*, /hermes/*, or the browser-tools WS
# protocol. Clients compare this against the version they were built for.
PROTOCOL_VERSION: int = 1
