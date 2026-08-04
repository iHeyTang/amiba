"""HTTP routes for ``/hermes/model/*`` — mirrors upstream ``/api/model/*``.

Path layout matches ``hermes_cli/web_server.py``:

- ``GET  /hermes/model/info``        — resolved metadata for the main model
- ``GET  /hermes/model/auxiliary``   — auxiliary slot assignments
- ``GET  /hermes/model/options``     — provider catalog + curated model lists
- ``GET  /hermes/model/moa``         — Mixture-of-Agents named presets
- ``PUT  /hermes/model/moa``         — persist Mixture-of-Agents presets
- ``POST /hermes/model/set``         — assign main or auxiliary slot
                                       (additive ``base_url`` field on ``scope=main``)

Mine-only endpoints (no upstream equivalent):

- ``GET  /hermes/provider-models?provider=…``  — per-provider model list
- ``GET  /hermes/provider-credentials?provider=…`` — plugin ``.env``
                                       credentials for one provider slug
- ``POST /hermes/provider-credentials`` — write credentials for one provider

Provider credentials are completely separated from main-model state:
writing credentials never touches ``config.yaml: model.*``. Setting the
main model is the sole responsibility of ``POST /hermes/model/set``.
"""

from __future__ import annotations

import asyncio
from functools import wraps
from urllib.parse import unquote

from aiohttp import web

from ....common import json_error, read_json_object, strip_ok
from ....adapters.dotenv_local import plugin_dotenv_path, read_dotenv_as_dict
from ....adapters.hermes_core import (
    current_profile_id,
    get_provider_profile,
    hermes_profile_scope,
)
from ....adapters.hermes_provider_env import env_var_names_for_slug
from .model_catalog_service import (
    build_provider_models_http_response,
    enrich_models_payload,
)
from .model_config_service import (
    read_auxiliary_models_response,
    read_main_model_response,
    write_auxiliary_models_response,
    write_main_model_response,
)
from .provider_credentials_service import (
    merge_credentials_for_provider,
    read_provider_credentials_response,
)
from .provider_connection_service import (
    allows_ambient_credentials,
    build_provider_connection,
)
from .virtual_capabilities_service import (
    read_moa_config_response,
    write_moa_config_response,
)


# ---------------------------------------------------------------------------
# GET /hermes/model/info — main model resolution + capabilities
# ---------------------------------------------------------------------------


async def handle_model_info(_request: web.Request) -> web.Response:
    """Resolved metadata for the main model.

    Returns ``{model, provider, base_url, auto_context_length,
    config_context_length, effective_context_length, capabilities}``.
    ``base_url`` is mine-only (upstream omits it); it's the resolved
    ``model.base_url`` from ``config.yaml`` so the UI can show "what
    URL is my main model talking to right now".
    """
    try:
        payload = read_main_model_response()
    except RuntimeError as exc:
        return json_error(501, str(exc))
    return web.json_response(strip_ok(payload))


# ---------------------------------------------------------------------------
# GET /hermes/model/auxiliary — auxiliary slot assignments
# ---------------------------------------------------------------------------


async def handle_model_auxiliary(_request: web.Request) -> web.Response:
    """Upstream shape, no additives::

        {"tasks": [{task, provider, model, base_url}, ...],
         "main":  {provider, model}}
    """
    try:
        payload = read_auxiliary_models_response()
    except RuntimeError as exc:
        return json_error(501, str(exc))
    return web.json_response(strip_ok(payload))


# ---------------------------------------------------------------------------
# GET/PUT /hermes/model/moa — virtual Mixture-of-Agents capability
# ---------------------------------------------------------------------------


async def handle_model_moa_get(_request: web.Request) -> web.Response:
    try:
        return web.json_response(read_moa_config_response())
    except RuntimeError as exc:
        return json_error(501, str(exc))


async def handle_model_moa_put(request: web.Request) -> web.Response:
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    try:
        return web.json_response(write_moa_config_response(body))
    except ValueError as exc:
        return json_error(400, str(exc))
    except RuntimeError as exc:
        return json_error(501, str(exc))


# ---------------------------------------------------------------------------
# POST /hermes/model/set — assign main or auxiliary slot
# ---------------------------------------------------------------------------


_AUX_RESET_SENTINEL = "__reset__"


async def handle_model_set(request: web.Request) -> web.Response:
    """Single write surface for both main and auxiliary slots.

    Body shape::

        {"scope":    "main" | "auxiliary",
         "provider": "<provider>",
         "model":    "<model id>",
         "base_url": "<url>" | null | (omitted),     # scope=main only
         "task":     "<aux slot>" | "__reset__" | ""}

    On ``scope="main"`` the optional ``base_url`` is additive over
    upstream — passing ``null`` clears ``model.base_url`` (used when
    switching from a custom endpoint back to a canonical provider);
    omitting it leaves the current value alone. On ``scope="auxiliary"``
    with ``task=""`` the (provider, model) pair is applied to every aux
    slot. ``task="__reset__"`` resets every aux slot to ``auto`` / ``""``.
    """
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc

    scope = str(body.get("scope") or "").strip().lower()
    provider = str(body.get("provider") or "").strip()
    model = str(body.get("model") or "").strip()
    task = str(body.get("task") or "").strip().lower()

    if scope not in {"main", "auxiliary"}:
        return json_error(400, "scope must be 'main' or 'auxiliary'")

    if scope == "main":
        # ``provider: "auto"`` with an empty model is the ✕-button reset
        # gesture — drop main back to "let the agent pick". Treat it as a
        # first-class signal so the UI's clear button doesn't 400 the same
        # way the auxiliary clear used to.
        is_reset = provider.lower() == "auto" and not model
        if not is_reset and (not provider or not model):
            return json_error(400, "provider and model required for main")
        write_payload: dict = {"provider": provider or "auto", "model": model}
        if "base_url" in body:
            write_payload["base_url"] = body.get("base_url")
        try:
            merged = write_main_model_response(write_payload)
        except ValueError as exc:
            return json_error(400, str(exc))
        except RuntimeError as exc:
            return json_error(501, str(exc))
        return web.json_response(merged)

    # scope == "auxiliary"
    from ....adapters.hermes_agent_model import AUXILIARY_SLOTS

    if task == _AUX_RESET_SENTINEL:
        try:
            for slot in AUXILIARY_SLOTS:
                write_auxiliary_models_response(
                    {"task": slot, "provider": "auto", "model": ""}
                )
        except ValueError as exc:
            return json_error(400, str(exc))
        except RuntimeError as exc:
            return json_error(501, str(exc))
        return web.json_response({"ok": True, "scope": "auxiliary", "reset": True})

    # Per-slot clear: ``{task: <slot>, provider: ""}`` (model irrelevant) is
    # the ✕-button gesture — drop that one slot back to inheriting the main
    # model. Without this branch the UI's clear button hits the global
    # "provider required" guard below, and the stale assignment is stuck
    # forever once the original provider (e.g. ai-gateway) is uninstalled.
    if task and task in AUXILIARY_SLOTS and not provider:
        try:
            write_auxiliary_models_response(
                {"task": task, "provider": "auto", "model": ""}
            )
        except ValueError as exc:
            return json_error(400, str(exc))
        except RuntimeError as exc:
            return json_error(501, str(exc))
        # Return the full updated ``tasks`` list (matching the GET shape) so
        # the UI's ``tasksToMap`` can refresh state without a second
        # round-trip. The "global reset" path doesn't bother because the UI
        # already refetches after — per-slot clear is hit from the inline ✕
        # which has no refetch.
        refreshed = read_auxiliary_models_response()
        refreshed["cleared"] = True
        return web.json_response(refreshed)

    if not provider:
        return json_error(400, "provider required for auxiliary")

    targets = [task] if task else list(AUXILIARY_SLOTS)
    for slot in targets:
        if slot not in AUXILIARY_SLOTS:
            return json_error(400, f"unknown auxiliary task: {slot}")
        try:
            write_auxiliary_models_response(
                {"task": slot, "provider": provider, "model": model}
            )
        except ValueError as exc:
            return json_error(400, str(exc))
        except RuntimeError as exc:
            return json_error(501, str(exc))

    return web.json_response(
        {
            "ok": True,
            "scope": "auxiliary",
            "tasks": targets,
            "provider": provider,
            "model": model,
        }
    )


# ---------------------------------------------------------------------------
# GET /hermes/model/options — provider catalog + curated model lists
# ---------------------------------------------------------------------------


async def handle_model_options(request: web.Request) -> web.Response:
    """Provider catalog + curated model lists.

    Delegates to ``hermes_cli.inventory.build_models_payload`` with the same
    complete inventory options as Hermes's dashboard picker:

    - ``include_unconfigured=True`` — append canonical providers the
      user hasn't authenticated yet (otherwise the picker can only
      show what's already wired up — you can't discover what else
      exists).
    - ``picker_hints=True`` — add ``authenticated``/``auth_type``/
      ``key_env``/``warning`` per row so the adapter can tell
      "user-config", "env-detected" and "unconfigured" apart.
    - ``canonical_order=True`` — keep Hermes's provider order.
    - ``pricing=True`` — include provider-backed live pricing where Hermes
      supports it.
    - ``capabilities=True`` — include the fast/reasoning fields Hermes
      explicitly publishes for each model.
    - ``refresh=...`` — honor the caller's explicit cache-busting request.

    No ``max_models`` limit is applied: this is the settings catalog, not the
    compact terminal picker, so every model returned by Hermes stays visible.

    Adds one mine-only field on top: ``configured_provider_slugs`` —
    the alias-resolved canonical slugs the user explicitly listed in
    ``config.yaml: providers:``. Needed because Hermes's
    ``list_authenticated_providers`` silently drops user-config rows
    when their slug is an alias of a canonical provider already
    emitted by the built-in/hermes overlay sections (e.g. user writes
    ``providers.vercel`` but the picker only shows ``ai-gateway``
    with ``source="hermes"`` — the ``user-config`` provenance is
    lost). The adapter uses this set to mark "Configured" badges
    correctly regardless of what ``source`` the row got.

    All extra fields are additive (upstream consumers ignore unknown
    keys), so this stays compatible with upstream's wire shape.

    When the helper isn't importable (running outside a Hermes venv —
    development / test only), returns 501 rather than serving a
    differently-shaped local fallback.
    """
    try:
        from hermes_cli.inventory import (  # type: ignore
            build_models_payload,
            load_picker_context,
        )
    except Exception as exc:
        return json_error(
            501,
            f"hermes_cli.inventory unavailable (run inside Hermes venv): {exc}",
        )

    try:
        refresh_value = request.query.get("refresh", "0")
        force_refresh = str(refresh_value).lower() in ("1", "true", "yes")
        ctx = await asyncio.to_thread(load_picker_context)
        payload = await asyncio.to_thread(
            build_models_payload,
            ctx,
            include_unconfigured=True,
            picker_hints=True,
            canonical_order=True,
            pricing=True,
            capabilities=True,
            refresh=force_refresh,
            probe_custom_providers=force_refresh,
            probe_current_custom_provider=not force_refresh,
            for_picker=True,
        )
        payload["configured_provider_slugs"] = _user_configured_canonical_slugs(ctx)
        # Strict "user configured this via the extension" set — reads
        # ``~/.hermes/.env`` directly so ambient creds (host env vars,
        # Claude Code OAuth, gh CLI, AWS SDK, …) don't pollute the UI's
        # "Configured" group with providers the user never touched here.
        try:
            from ....adapters.hermes_provider_env import (
                provider_slugs_configured_in_dotenv,
            )
            row_slugs = [
                str(r.get("slug") or "").strip()
                for r in payload.get("providers") or []
                if isinstance(r, dict) and r.get("slug")
            ]
            payload["dotenv_configured_provider_slugs"] = (
                provider_slugs_configured_in_dotenv(row_slugs)
            )
        except Exception:
            payload["dotenv_configured_provider_slugs"] = []
        # Hermes's inventory runs inside the long-lived backplane process.
        # For a named Profile, process-global API keys belong to the default
        # Profile and must not make that provider look executable. Reconcile
        # every row with the same Profile-local .env / shared-login rules used
        # by the credential editor and task runtime.
        await asyncio.to_thread(_apply_profile_runtime_connections, payload)
        # Replace ai-gateway's curated 16-model subset with Vercel's
        # actual live catalog. ``hermes_cli.models.fetch_ai_gateway_models``
        # intersects Vercel's ``/v1/models`` response with a hard-coded
        # "recommended" list, so users see ~16 models when Vercel
        # actually exposes 100+. The curated list might be a reasonable
        # default in a terminal picker; in the extension's "All available
        # models" view it just looks broken ("I configured Vercel — why
        # is half of it missing?").
        await _expand_ai_gateway_models(payload, force_refresh=force_refresh)
        # Keep Hermes's complete picker inventory, including its runtime fast
        # gate and provider-backed live pricing. The settings surface also
        # exposes optional models.dev profiles, but they remain isolated under
        # ``supplemental`` so community data is never presented as provider or
        # Hermes-owned metadata.
        await asyncio.to_thread(enrich_models_payload, payload)
        return web.json_response(payload)
    except Exception as exc:
        return json_error(500, f"failed to list model options: {exc}")


def _apply_profile_runtime_connections(payload: object) -> None:
    rows = payload.get("providers") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return
    profile_id = current_profile_id()
    saved_values = read_dotenv_as_dict(plugin_dotenv_path())
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = str(row.get("slug") or "").strip()
        if not slug:
            continue
        prof = get_provider_profile(slug)
        auth_type = str(
            row.get("auth_type")
            or getattr(prof, "auth_type", "")
            or ""
        ).strip()
        secret_keys = env_var_names_for_slug(slug)
        key_env = str(row.get("key_env") or "").strip()
        if key_env and key_env not in secret_keys:
            secret_keys.append(key_env)
        allow_ambient = allows_ambient_credentials(auth_type, profile_id)
        connection = build_provider_connection(
            slug,
            auth_type=auth_type,
            secret_keys=secret_keys,
            saved_values=saved_values,
            verify_service=False,
            allow_ambient_env=allow_ambient,
        )
        row["connection"] = connection
        row["credential_scope"] = connection.get("active_scope", "none")
        status = str(connection.get("status") or "none")
        connection_usable = status in {"configured", "detected", "verified"}
        original_authenticated = row.get("authenticated") is True
        source = str(row.get("source") or "").strip()
        config_only_runtime = (
            source == "user-config"
            and original_authenticated
            and not secret_keys
        )
        no_secret_runtime = auth_type in {
            "local",
            "none",
            "virtual",
        }
        row["authenticated"] = bool(
            connection_usable
            or config_only_runtime
            or (no_secret_runtime and original_authenticated)
        )


async def _expand_ai_gateway_models(
    payload: object, *, force_refresh: bool = False
) -> None:
    """Overwrite the ai-gateway row's ``models`` with Vercel's full live
    catalog when authenticated. Silently no-ops on any failure — the
    curated fallback Hermes provided stays in place.
    """
    rows = payload.get("providers") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return
    target = None
    for r in rows:
        if isinstance(r, dict) and r.get("slug") == "ai-gateway":
            target = r
            break
    if target is None or not target.get("authenticated"):
        return
    full = await asyncio.to_thread(
        _fetch_ai_gateway_full_catalog_sync, force_refresh=force_refresh
    )
    if not full:
        return
    target["models"] = full
    target["total_models"] = len(full)


_AI_GATEWAY_CATALOG_CACHE: tuple[float, list[dict]] | None = None
_AI_GATEWAY_CATALOG_TTL_S = 300.0


def _fetch_ai_gateway_full_catalog_sync(
    *, force_refresh: bool = False
) -> list[dict]:
    """Blocking helper: hit ``https://ai-gateway.vercel.sh/v1/models``
    (public, no auth needed for listing) and return rich entries
    ``{id, description?, metadata?}`` for every model. The extension's
    ``ModelEntryMetadataLine`` renders ``input_price_per_mtok`` /
    ``output_price_per_mtok`` automatically if metadata carries them,
    so we extract pricing here instead of letting it get stripped
    upstream.

    Cached for 5 min so the catalog endpoint stays cheap on repeated
    refreshes. Runs inside ``asyncio.to_thread`` so the event loop
    isn't blocked.
    """
    import json as _json
    import time as _time
    import urllib.request as _ur

    global _AI_GATEWAY_CATALOG_CACHE
    now = _time.monotonic()
    if not force_refresh and _AI_GATEWAY_CATALOG_CACHE is not None:
        stamp, cached = _AI_GATEWAY_CATALOG_CACHE
        if now - stamp < _AI_GATEWAY_CATALOG_TTL_S:
            return [dict(e) for e in cached]
    try:
        from hermes_constants import AI_GATEWAY_BASE_URL  # type: ignore
    except Exception:
        AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
    url = f"{str(AI_GATEWAY_BASE_URL).rstrip('/')}/models"
    try:
        req = _ur.Request(url, headers={"Accept": "application/json"})
        with _ur.urlopen(req, timeout=8.0) as resp:
            data = _json.loads(resp.read().decode())
    except Exception:
        return []
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        entry: dict = {"id": mid}
        meta: dict = {}

        # description: prefer Vercel's ``description`` (the prose blurb);
        # the existing UI renders ``entry.description`` in its own line
        # above the metadata chips. ``name`` is too short to deserve its
        # own slot — fold it in as a prefix on long blurbs and drop it
        # when the prose already starts with the name.
        prose = str(item.get("description") or "").strip()
        name = str(item.get("name") or "").strip()
        if prose:
            entry["description"] = prose
        elif name:
            entry["description"] = name

        pricing = item.get("pricing")
        if isinstance(pricing, dict):
            # Vercel's pricing is **per-token** USD strings:
            #   "0.00000012" = $0.12 per million tokens.
            # The UI's metadata renderer suffixes "$/M", so we multiply
            # by 1e6 and round before passing through. (Earlier revision
            # assumed per-million and shipped raw — rendered $0.00000012
            # /M, which is obviously broken.)
            ipt = _coerce_float(pricing.get("input"))
            opt = _coerce_float(pricing.get("output"))
            if ipt is not None and ipt > 0:
                meta["input_price_per_mtok"] = round(ipt * 1_000_000, 4)
            if opt is not None and opt > 0:
                meta["output_price_per_mtok"] = round(opt * 1_000_000, 4)
            # Tag free models (both prices exactly 0) so the existing
            # ``description: "free"`` UI affordance lights up. Override
            # any prose description — "free" is the salient signal.
            if (ipt is not None and ipt == 0) and (opt is not None and opt == 0):
                entry["description"] = "free"

        ctx_window = item.get("context_window") or item.get("context_length")
        if isinstance(ctx_window, (int, float)) and ctx_window > 0:
            meta["context_window"] = int(ctx_window)
        max_out = item.get("max_tokens") or item.get("max_output_tokens")
        if isinstance(max_out, (int, float)) and max_out > 0:
            meta["max_output_tokens"] = int(max_out)

        tags = item.get("tags")
        if isinstance(tags, list):
            clean_tags = [str(t).strip() for t in tags if str(t).strip()]
            if clean_tags:
                meta["tags"] = clean_tags

        if meta:
            entry["metadata"] = meta
        out.append(entry)
    if out:
        _AI_GATEWAY_CATALOG_CACHE = (now, [dict(e) for e in out])
    return out


def _coerce_float(value: object) -> float | None:
    """``float(value)`` swallowing TypeError/ValueError; returns None on
    failure. Used for permissive parsing of Vercel's stringified
    pricing fields.
    """
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None




def _user_configured_canonical_slugs(ctx) -> list[str]:
    """Canonical (alias-resolved) slugs of providers the user wrote in
    ``~/.hermes/config.yaml: providers:``.

    The raw ``user_providers`` dict on ``ctx`` keys by whatever the
    user typed (``vercel``, ``claude``, ``deep-seek``…). Run each
    through ``normalize_provider`` so the adapter can match them
    against the alias-resolved slugs that show up in row data
    (``ai-gateway``, ``anthropic``, ``deepseek``…).
    """
    try:
        from hermes_cli.models import normalize_provider  # type: ignore
    except Exception:
        return []
    raw = getattr(ctx, "user_providers", None) or {}
    if not isinstance(raw, dict):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for key in raw.keys():
        canon = normalize_provider(str(key))
        if canon and canon not in seen:
            seen.add(canon)
            out.append(canon)
    return out


# ---------------------------------------------------------------------------
# GET /hermes/provider-models — per-provider model list (mine-only)
# ---------------------------------------------------------------------------


async def handle_provider_models(request: web.Request) -> web.Response:
    refresh_pm = request.query.get("refresh", "0")
    force_pm = str(refresh_pm).lower() in ("1", "true", "yes")
    provider_pm = unquote(str(request.query.get("provider", ""))).strip()
    if not provider_pm:
        return json_error(400, "missing provider query parameter")
    body_pm = await asyncio.to_thread(
        build_provider_models_http_response,
        provider=provider_pm,
        force_refresh=force_pm,
    )
    return web.json_response(body_pm)


# ---------------------------------------------------------------------------
# GET/POST /hermes/provider-credentials — plugin .env credentials (mine-only)
# ---------------------------------------------------------------------------


async def handle_provider_credentials_get(request: web.Request) -> web.Response:
    """Return ``{provider, keys, values}`` for one provider.

    ``keys`` is the env-var allow-list for the provider (from the
    Hermes profile registry); ``values`` is whatever's currently set
    in the plugin ``.env`` for those keys. Empty list when the
    provider has no registered credential keys (``auto``, OAuth-only
    providers, etc.).
    """
    provider = unquote(str(request.query.get("provider", ""))).strip()
    if not provider:
        return json_error(400, "missing provider query parameter")
    verify_service = str(request.query.get("verify", "0")).lower() in (
        "1",
        "true",
        "yes",
    )
    try:
        import asyncio as _asyncio

        payload = await _asyncio.to_thread(
            read_provider_credentials_response,
            provider,
            verify_service=verify_service,
        )
        return web.json_response(payload)
    except ValueError as exc:
        return json_error(400, str(exc))


async def handle_provider_credentials_post(request: web.Request) -> web.Response:
    """Merge values into plugin ``.env`` for one provider's allow-listed keys.

    Body::

        {"provider": "<slug>",
         "values":   {"OPENAI_API_KEY": "sk-…", …}}

    Only keys in the provider's allow-list are written; unknown keys
    are silently ignored (defence against UI bugs sending wrong keys
    to wrong providers). ``config.yaml`` is never touched by this
    endpoint — credentials are entirely .env-side.
    """
    try:
        body = await read_json_object(request)
    except web.HTTPBadRequest as exc:
        return exc
    provider = str(body.get("provider") or "").strip()
    if not provider:
        return json_error(400, "provider required")
    values = body.get("values")
    if values is None:
        values = {}
    if not isinstance(values, dict):
        return json_error(400, "values must be an object")
    try:
        import asyncio as _asyncio

        written = await _asyncio.to_thread(
            merge_credentials_for_provider,
            provider,
            values,
        )
        payload = await _asyncio.to_thread(
            read_provider_credentials_response,
            provider,
            verify_service=True,
        )
    except ValueError as exc:
        return json_error(400, str(exc))
    payload["written"] = written
    return web.json_response(payload)


def register_model_routes(app: web.Application) -> None:
    def profiled(handler):
        @wraps(handler)
        async def wrapped(request: web.Request) -> web.Response:
            with hermes_profile_scope(request.query.get("profile")):
                return await handler(request)

        return wrapped

    app.add_routes(
        [
            web.get("/hermes/model/info", profiled(handle_model_info)),
            web.get("/hermes/model/auxiliary", profiled(handle_model_auxiliary)),
            web.get("/hermes/model/options", profiled(handle_model_options)),
            web.get("/hermes/model/moa", profiled(handle_model_moa_get)),
            web.put("/hermes/model/moa", profiled(handle_model_moa_put)),
            web.post("/hermes/model/set", profiled(handle_model_set)),
            # Mine-only beyond this line.
            web.get("/hermes/provider-models", profiled(handle_provider_models)),
            web.get(
                "/hermes/provider-credentials",
                profiled(handle_provider_credentials_get),
            ),
            web.post(
                "/hermes/provider-credentials",
                profiled(handle_provider_credentials_post),
            ),
        ]
    )
