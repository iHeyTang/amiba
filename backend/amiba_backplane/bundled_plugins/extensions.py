"""Native Hermes toolset for Amiba-managed Extensions.

The Electron host owns Extension lifecycle and MCP App runtimes.  This module is
loaded through Hermes' bundled plugin system and projects that host capability
into the native tool registry, so Profiles see an ordinary ``extensions``
toolset instead of an external MCP server.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import threading
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

_BRIDGE_URL_ENV = "AMIBA_EXTENSIONS_BRIDGE_URL"
_BRIDGE_TOKEN_ENV = "AMIBA_EXTENSIONS_BRIDGE_TOKEN"
_MAX_BINARY_BYTES = 50 * 1024 * 1024
_STATIC_TOOL_NAMES: set[str] = set()
_DYNAMIC_TOOL_NAMES: set[str] = set()
_WATCHER_STARTED = False
_REGISTRATION_LOCK = threading.RLock()


def _object_schema(
    properties: dict[str, Any],
    required: list[str] | None = None,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required
    return schema


_STATIC_TOOLS: tuple[dict[str, Any], ...] = (
    {
        "name": "amiba_create_extension",
        "description": "Create an Amiba Extension from an ordinary user conversation. Always use this instead of writing managed-extensions state yourself. Reuse operation_id when retrying the same user request, then follow agentPrompt in the returned isolated workspace.",
        "inputSchema": _object_schema(
            {
                "name": {"type": "string", "description": "Short user-facing Extension name."},
                "request": {"type": "string", "description": "Complete description of what the Extension should do."},
                "description": {"type": "string", "description": "Optional one-line library description."},
                "operation_id": {"type": "string", "description": "Stable unique key for this user message; reuse it for retries."},
            },
            ["name", "request", "operation_id"],
        ),
    },
    {
        "name": "amiba_update_extension",
        "description": "Start an isolated Agent draft to improve an existing Amiba Extension. Follow agentPrompt and edit only the returned workspace.",
        "inputSchema": _object_schema(
            {
                "extension_id": {"type": "string"},
                "request": {"type": "string", "description": "The requested change."},
            },
            ["extension_id", "request"],
        ),
    },
    {
        "name": "amiba_preview_extension_draft",
        "description": "Build and validate the current isolated Extension draft, serve its selected UI surface on localhost, and open it in Amiba's visible built-in browser. Inspect the page with the amiba_browser tools before submitting .amiba/result.json.",
        "inputSchema": _object_schema(
            {
                "extension_id": {"type": "string"},
                "draft_id": {"type": "string"},
                "surface": {"type": "string", "enum": ["main", "settings"], "default": "main"},
                "run_tests": {"type": "boolean", "default": True},
            },
            ["extension_id", "draft_id"],
        ),
    },
    {
        "name": "amiba_get_extension_status",
        "description": "Get the current creation, update, candidate, or active status of an Amiba Extension.",
        "inputSchema": _object_schema(
            {"extension_id": {"type": "string"}}, ["extension_id"]
        ),
    },
    {
        "name": "amiba_list_extensions",
        "description": "List Amiba Extensions, including their stable IDs and current statuses.",
        "inputSchema": _object_schema(
            {"include_archived": {"type": "boolean", "default": False}}
        ),
    },
    {
        "name": "amiba_cancel_extension_operation",
        "description": "Cancel a pending Amiba Extension creation or update and clean its isolated draft.",
        "inputSchema": _object_schema(
            {
                "extension_id": {"type": "string"},
                "draft_id": {"type": "string"},
                "reason": {"type": "string"},
            },
            ["extension_id", "draft_id"],
        ),
    },
    {
        "name": "amiba_list_extension_resources",
        "description": "List non-UI MCP resources exposed by active Amiba Extensions.",
        "inputSchema": _object_schema({}),
    },
    {
        "name": "amiba_read_extension_resource",
        "description": "Read a resource URI returned by amiba_list_extension_resources.",
        "inputSchema": _object_schema(
            {"uri": {"type": "string", "description": "An amiba-extension:// resource URI."}},
            ["uri"],
        ),
    },
)


def _bridge_base_url() -> str:
    value = os.environ.get(_BRIDGE_URL_ENV, "").strip().rstrip("/")
    parsed = urlparse(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or not parsed.port
        or parsed.path not in {"", "/"}
    ):
        raise RuntimeError("Amiba Extensions bridge is unavailable")
    return value


def _bridge_request(
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    timeout: float = 10.0,
) -> Any:
    token = os.environ.get(_BRIDGE_TOKEN_ENV, "").strip()
    if not token:
        raise RuntimeError("Amiba Extensions bridge token is unavailable")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{_bridge_base_url()}{path}",
        data=body,
        method="POST" if payload is not None else "GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - loopback validated above
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            result = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RuntimeError(f"Amiba Extensions bridge failed ({exc.code})") from exc
        if isinstance(result, dict):
            raise RuntimeError(
                str(result.get("error") or f"Amiba Extensions bridge failed ({exc.code})")
            ) from exc
        raise RuntimeError(f"Amiba Extensions bridge failed ({exc.code})") from exc
    if isinstance(result, dict) and result.get("ok") is False:
        raise RuntimeError(str(result.get("error") or "Amiba Extensions bridge failed"))
    return result


def _bridge_available() -> bool:
    try:
        result = _bridge_request("/health", timeout=0.5)
        return isinstance(result, dict) and result.get("ok") is True
    except Exception:
        return False


def _cache_binary(data: str, mime_type: str, uri: str = "") -> str:
    if len(data) > (_MAX_BINARY_BYTES * 4 // 3 + 4):
        return "[Extension binary resource is too large to cache]"
    raw = base64.b64decode(data, validate=True)
    if len(raw) > _MAX_BINARY_BYTES:
        return "[Extension binary resource is too large to cache]"
    normalized_mime = mime_type.split(";", 1)[0].strip().lower()
    if normalized_mime.startswith("image/"):
        from gateway.platforms.base import cache_image_from_bytes

        ext = mimetypes.guess_extension(normalized_mime) or ".png"
        return f"MEDIA:{cache_image_from_bytes(raw, ext=ext)}"
    if normalized_mime.startswith("audio/"):
        from gateway.platforms.base import cache_audio_from_bytes

        ext = mimetypes.guess_extension(normalized_mime) or ".ogg"
        return f"MEDIA:{cache_audio_from_bytes(raw, ext=ext)}"
    from gateway.platforms.base import cache_document_from_bytes

    parsed = urlparse(uri)
    filename = Path(parsed.path).name or f"resource{mimetypes.guess_extension(normalized_mime) or '.bin'}"
    path = cache_document_from_bytes(raw, filename)
    return f"[Extension resource saved to {path} ({normalized_mime or 'unknown type'})]"


def _render_content_block(block: Any) -> str:
    if not isinstance(block, dict):
        return ""
    block_type = str(block.get("type") or "")
    if block_type == "text":
        return str(block.get("text") or "")
    if block_type in {"image", "audio"} and isinstance(block.get("data"), str):
        return _cache_binary(
            block["data"],
            str(block.get("mimeType") or "application/octet-stream"),
        )
    if block_type == "resource_link":
        uri = str(block.get("uri") or "")
        return f"[Extension resource link: {uri} — read it with amiba_read_extension_resource]"
    if block_type == "resource" and isinstance(block.get("resource"), dict):
        resource = block["resource"]
        if resource.get("text") is not None:
            return str(resource["text"])
        if isinstance(resource.get("blob"), str):
            return _cache_binary(
                resource["blob"],
                str(resource.get("mimeType") or "application/octet-stream"),
                str(resource.get("uri") or ""),
            )
    return ""


def _render_bridge_result(response: Any) -> str:
    result = response.get("result") if isinstance(response, dict) else response
    if isinstance(result, str):
        return result
    if not isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False, default=str)
    if result.get("isError") is True:
        message = "\n".join(
            value
            for value in (_render_content_block(block) for block in result.get("content", []))
            if value
        )
        raise RuntimeError(message or "Extension tool returned an error")
    parts = [
        value
        for value in (_render_content_block(block) for block in result.get("content", []))
        if value
    ]
    for content in result.get("contents", []):
        if not isinstance(content, dict):
            continue
        if content.get("text") is not None:
            parts.append(str(content["text"]))
        elif isinstance(content.get("blob"), str):
            parts.append(
                _cache_binary(
                    content["blob"],
                    str(content.get("mimeType") or "application/octet-stream"),
                    str(content.get("uri") or ""),
                )
            )
    if parts:
        return "\n".join(parts)
    structured = result.get("structuredContent")
    return json.dumps(structured if structured is not None else result, ensure_ascii=False)


def _handler(name: str):
    def call(arguments: dict[str, Any], **_kwargs: Any) -> str:
        response = _bridge_request(
            "/call",
            payload={"name": name, "arguments": arguments or {}},
            timeout=120.0,
        )
        return _render_bridge_result(response)

    return call


def _schema(definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(definition["name"]),
        "description": str(definition.get("description") or ""),
        "parameters": definition.get("inputSchema")
        if isinstance(definition.get("inputSchema"), dict)
        else _object_schema({}),
    }


def _register_definition(ctx: Any, definition: dict[str, Any]) -> None:
    name = str(definition.get("name") or "").strip()
    toolset = str(definition.get("toolset") or "extensions").strip()
    if not name or not toolset:
        return
    ctx.register_tool(
        name=name,
        toolset=toolset,
        schema=_schema(definition),
        handler=_handler(name),
        check_fn=_bridge_available,
        description=str(definition.get("description") or ""),
        emoji="🧩" if toolset == "extensions" else "🌐",
    )


def _refresh_catalog(ctx: Any, after: int = 0, wait_ms: int = 0) -> int:
    from tools.registry import registry

    response = _bridge_request(
        f"/catalog?after={max(0, after)}&wait_ms={max(0, min(wait_ms, 30000))}",
        timeout=max(5.0, wait_ms / 1000 + 5.0),
    )
    generation = int(response.get("generation") or after)
    if generation <= after:
        return generation
    definitions = response.get("tools") if isinstance(response, dict) else []
    if not isinstance(definitions, list):
        return generation
    dynamic = {
        str(item.get("name")): item
        for item in definitions
        if isinstance(item, dict)
        and str(item.get("name") or "") not in _STATIC_TOOL_NAMES
    }
    with _REGISTRATION_LOCK:
        for name in _DYNAMIC_TOOL_NAMES - set(dynamic):
            registry.deregister(name)
        for definition in dynamic.values():
            _register_definition(ctx, definition)
        _DYNAMIC_TOOL_NAMES.clear()
        _DYNAMIC_TOOL_NAMES.update(dynamic)
    return generation


def _watch_catalog(ctx: Any, generation: int) -> None:
    while True:
        try:
            generation = _refresh_catalog(ctx, generation, 25_000)
        except Exception as exc:  # noqa: BLE001 - bridge restarts are recoverable
            logger.debug("Amiba Extensions catalog watch paused: %s", exc)
            threading.Event().wait(2.0)


def _remove_legacy_mcp_projection() -> None:
    try:
        from hermes_cli.config import load_config, save_config

        config = load_config()
        if not isinstance(config, dict):
            return
        # These are persisted identifiers from the former Applets model. Keep
        # them local to migration so the rest of the product has one noun.
        legacy_mcp_server = "amiba-applets"
        legacy_toolset = "applets"
        canonical_toolset = "extensions"
        changed = False
        servers = config.get("mcp_servers")
        if isinstance(servers, dict) and legacy_mcp_server in servers:
            servers.pop(legacy_mcp_server, None)
            changed = True
        platform_toolsets = config.get("platform_toolsets")
        if isinstance(platform_toolsets, dict):
            for platform, values in list(platform_toolsets.items()):
                if not isinstance(values, list):
                    continue
                migrated: list[Any] = []
                for value in values:
                    normalized = str(value)
                    if normalized == legacy_mcp_server:
                        continue
                    replacement = (
                        canonical_toolset if normalized == legacy_toolset else value
                    )
                    if replacement not in migrated:
                        migrated.append(replacement)
                if migrated != values:
                    platform_toolsets[platform] = migrated
                    changed = True
        if changed:
            save_config(config)
    except Exception as exc:  # pragma: no cover - migration is best effort
        logger.debug("Could not migrate legacy Extensions config: %s", exc)


def register(ctx: Any) -> None:
    """Register Amiba's built-in Extension tools through Hermes' plugin API."""

    global _WATCHER_STARTED
    _remove_legacy_mcp_projection()
    for definition in _STATIC_TOOLS:
        _STATIC_TOOL_NAMES.add(str(definition["name"]))
        _register_definition(ctx, {**definition, "toolset": "extensions"})
    if not _bridge_available():
        return
    try:
        generation = _refresh_catalog(ctx)
    except Exception as exc:  # pragma: no cover - availability already probed
        logger.warning("Could not load Amiba Extensions tool catalog: %s", exc)
        return
    if _WATCHER_STARTED:
        return
    _WATCHER_STARTED = True
    threading.Thread(
        target=_watch_catalog,
        args=(ctx, generation),
        name="amiba-extensions-tool-catalog",
        daemon=True,
    ).start()
