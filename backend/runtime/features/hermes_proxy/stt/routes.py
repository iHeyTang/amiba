"""HTTP routes for ``/hermes/stt`` — see this package's ``__init__.py``.

All audio handling is contained here:

  POST /hermes/stt
    Body:   raw audio bytes (Content-Type tells us the container).
    Query:  none (provider / model are resolved by the gateway's own
            ``stt.*`` config in ``~/.hermes/config.yaml``).
    Reply:  ``{"text": str, "provider": str | null, "duration_ms": int}``

  GET /hermes/stt/status
    Reply:  ``{"enabled": bool, "provider": str, "available": [str],
              "local_model": str | null}``

The renderer treats success/error as a flat shape (no ``ok`` envelope),
matching the upstream Hermes dashboard's ``/api/*`` style.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from typing import Any, Dict

from aiohttp import web

from ....common import json_error, read_json_object
from . import config_service

logger = logging.getLogger(__name__)


# Map common audio MIME types to file extensions so the downstream
# pipeline (faster-whisper / ffmpeg / cloud API) picks the right demuxer.
# Unknown types fall back to ``.webm`` — that's what Chromium's
# MediaRecorder emits by default, and what the desktop composer sends.
_EXT_MAP = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
}


def _suffix_for(content_type: str) -> str:
    primary = (content_type or "").lower().split(";")[0].strip()
    return _EXT_MAP.get(primary, ".webm")


async def handle_transcribe(request: web.Request) -> web.Response:
    """Transcribe one audio clip via hermes-agent's STT pipeline."""
    body = await request.read()
    if not body:
        return json_error(400, "empty audio body")

    suffix = _suffix_for(request.headers.get("Content-Type", ""))
    model_override = request.query.get("model") or None

    tmp_path: str | None = None
    t0 = time.monotonic()
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(body)
            tmp_path = tmp.name

        # Lazy import — the plugin loads in environments where
        # hermes-agent is always present (it's the host), but keep the
        # import inside the handler so plugin import-time stays cheap
        # and so the module surfaces a clean 503 if upstream ever ships
        # without ``tools.transcription_tools`` for some reason.
        try:
            from tools.transcription_tools import transcribe_audio  # type: ignore
        except Exception as exc:  # pragma: no cover — defensive
            logger.exception("STT module unavailable")
            return json_error(503, f"STT unavailable: {exc}")

        # transcribe_audio is sync and may block on local whisper /
        # remote HTTP calls; hand it to a worker so the event loop
        # keeps serving other backplane traffic.
        result: Dict[str, Any] = await asyncio.to_thread(
            transcribe_audio, tmp_path, model_override
        )
    except Exception as exc:
        logger.exception("POST /hermes/stt failed")
        return json_error(500, f"STT transcription failed: {exc}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    if not result.get("success"):
        # Bubble the underlying failure string verbatim — the user-facing
        # STT pipeline already produces friendly diagnostics (missing
        # ffmpeg, bad API key, etc.) that we don't want to flatten.
        return json_error(400, result.get("error") or "transcription failed")

    return web.json_response(
        {
            "text": result.get("transcript", ""),
            "provider": result.get("provider"),
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }
    )


async def handle_status(_request: web.Request) -> web.Response:
    """Report the effective STT config so the Voice settings page can
    surface what's about to run without the user reading config.yaml.

    Returns ``{"enabled", "provider", "available", "local_model"}``.
    ``provider`` is the resolved name after availability checks (so
    ``"local"`` will surface as ``"none"`` if faster-whisper isn't
    installed and no fallback works).
    """
    try:
        from tools.transcription_tools import (  # type: ignore
            _get_provider,
            _load_stt_config,
            is_stt_enabled,
        )
    except Exception as exc:  # pragma: no cover — defensive
        return json_error(503, f"STT unavailable: {exc}")

    stt_config = _load_stt_config()
    enabled = bool(is_stt_enabled(stt_config))
    resolved = _get_provider(stt_config) if enabled else "none"
    configured = (stt_config.get("provider") or "").strip().lower() or None
    local_cfg = stt_config.get("local")
    if not isinstance(local_cfg, dict):
        local_cfg = {}
    local_model = local_cfg.get("model")
    if not isinstance(local_model, str) or not local_model.strip():
        local_model = None

    available = _detect_available_providers()
    local_model_cached = _is_local_model_cached(local_model) if local_model else False
    local_models_cached = {
        name: _is_local_model_cached(name) for name in SUPPORTED_LOCAL_MODELS
    }

    return web.json_response(
        {
            "enabled": enabled,
            "provider": resolved,
            "configured": configured,
            "available": available,
            "local_model": local_model,
            "local_model_cached": local_model_cached,
            "local_models_cached": local_models_cached,
        }
    )


# UI-exposed local model sizes. Keep in sync with ``LOCAL_MODEL_SIZES``
# in packages/settings-ui/src/SettingsVoice.tsx. Sizes outside this list
# still work (faster-whisper accepts any HF repo id), they just don't get
# a per-row "cached?" entry in the status response.
SUPPORTED_LOCAL_MODELS = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3",
    "turbo",
)


def _resolve_model_repo(model_name: str) -> str:
    """Map a faster-whisper model name (``tiny``, ``turbo``, …) to its HF
    Hub repo id. Mirrors the ``_MODELS`` table inside faster-whisper so
    ``turbo`` resolves to ``mobiuslabsgmbh/...`` instead of a nonexistent
    ``Systran/faster-whisper-turbo``. Falls back to the Systran naming
    convention for anything else."""
    try:
        from faster_whisper.utils import _MODELS  # type: ignore[attr-defined]
        if model_name in _MODELS:
            return _MODELS[model_name]
    except Exception:
        pass
    return f"Systran/faster-whisper-{model_name}"


def _is_local_model_cached(model_name: str) -> bool:
    """Best-effort check whether the named faster-whisper model is in the
    HF Hub cache. Returns False (rather than raising) on any failure so a
    missing huggingface_hub or unknown repo just degrades to "show the
    download hint" — which is the safer side to err on.
    """
    if not model_name:
        return False
    try:
        from huggingface_hub import try_to_load_from_cache
    except Exception:
        return False
    repo_id = _resolve_model_repo(model_name)
    try:
        path = try_to_load_from_cache(repo_id=repo_id, filename="model.bin")
    except Exception:
        return False
    return isinstance(path, str)


async def handle_download_local_model(request: web.Request) -> web.Response:
    """Eagerly download a faster-whisper model into the HF Hub cache so
    the next transcription doesn't pay the ~150 MB–3 GB cold-start cost.

    Body: ``{"model": "base"}``. Runs ``faster_whisper.download_model``
    in a worker thread (it blocks for the entire snapshot pull). Returns
    a flat ``{"model", "ok": true}`` on success, or ``{"error": ...}``
    via :func:`json_error` on failure.
    """
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    model_name = body.get("model")
    if not isinstance(model_name, str) or not model_name.strip():
        return json_error(400, "'model' required")
    model_name = model_name.strip()

    try:
        from faster_whisper import download_model  # type: ignore
    except Exception as exc:
        return json_error(503, f"faster-whisper unavailable: {exc}")

    try:
        await asyncio.to_thread(download_model, model_name)
    except ValueError as exc:
        # download_model raises ValueError on unknown size — bubble as 400
        # so the renderer can show a "bad model name" error instead of 500.
        return json_error(400, str(exc))
    except Exception as exc:
        logger.exception("STT local-model download failed")
        return json_error(500, f"download failed: {exc}")

    return web.json_response({"model": model_name, "ok": True})


def _detect_available_providers() -> list[str]:
    """Best-effort list of providers the user could pick today.

    Reads what's installed + what API keys are set without actually
    initialising any of them. Surfaced to the UI so the Voice settings
    page can grey out unconfigured choices.
    """
    out: list[str] = []
    try:
        from tools.transcription_tools import (  # type: ignore
            _HAS_FASTER_WHISPER,
            _HAS_OPENAI,
            _HAS_MISTRAL,
            _has_local_command,
            _has_openai_audio_backend,
            get_env_value,
        )
    except Exception:
        return out

    if _HAS_FASTER_WHISPER or _has_local_command():
        out.append("local")
    if _HAS_OPENAI and get_env_value("GROQ_API_KEY"):
        out.append("groq")
    if _HAS_OPENAI and _has_openai_audio_backend():
        out.append("openai")
    if _HAS_MISTRAL and get_env_value("MISTRAL_API_KEY"):
        out.append("mistral")
    if get_env_value("ELEVENLABS_API_KEY"):
        out.append("elevenlabs")
    return out


async def handle_get_config(_request: web.Request) -> web.Response:
    """GET /hermes/stt/config — current stt.* section + key presence."""
    try:
        return web.json_response(config_service.read_config_response())
    except Exception as exc:
        logger.exception("GET /hermes/stt/config failed")
        return json_error(500, f"failed to read STT config: {exc}")


async def handle_post_config(request: web.Request) -> web.Response:
    """POST /hermes/stt/config — deep-merge patch into stt.* and save.

    Body shape mirrors the GET response (minus ``credentials``).
    Returns the refreshed config on success so the UI can render
    without a second round-trip.
    """
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    try:
        return web.json_response(config_service.update_config(body))
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:
        logger.exception("POST /hermes/stt/config failed")
        return json_error(500, f"failed to write STT config: {exc}")


async def handle_post_credentials(request: web.Request) -> web.Response:
    """POST /hermes/stt/credentials — merge provider API keys into .env.

    Body::

        {"provider": "groq", "values": {"GROQ_API_KEY": "gsk_..."}}

    Empty-string values delete the key. Only env vars on the
    provider's allow-list are accepted (see ``config_service.CREDENTIAL_KEYS``).
    Returns the refreshed config (with updated ``has_key`` booleans).
    """
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc

    provider = body.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        return json_error(400, "'provider' required")
    values = body.get("values")
    if values is None:
        values = {}
    try:
        return web.json_response(
            config_service.update_credentials(provider, values)
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    except Exception as exc:
        logger.exception("POST /hermes/stt/credentials failed")
        return json_error(500, f"failed to write credentials: {exc}")


def register(app: web.Application) -> None:
    app.add_routes(
        [
            web.post("/hermes/stt", handle_transcribe),
            web.get("/hermes/stt/status", handle_status),
            web.get("/hermes/stt/config", handle_get_config),
            web.post("/hermes/stt/config", handle_post_config),
            web.post("/hermes/stt/credentials", handle_post_credentials),
            web.post(
                "/hermes/stt/local-model/download", handle_download_local_model
            ),
        ]
    )
