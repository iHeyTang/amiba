"""Model-catalog composition shared by the settings HTTP routes."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from ....adapters.hermes_model_catalog import get_model_catalog_manifest
from .provider_models_service import build_provider_models_response


def _mapping_entry(value: Any, key: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    entry = value.get(key)
    return dict(entry) if isinstance(entry, dict) else {}


def _merge_hermes_inventory_metadata(
    metadata: Dict[str, Any],
    *,
    capabilities: Dict[str, Any],
    pricing: Dict[str, Any],
) -> None:
    """Merge fields explicitly published by Hermes's picker inventory.

    Amiba treats the Hermes API response as the contract boundary. Hermes may
    consult another registry while producing that response, but a field Hermes
    deliberately publishes still belongs to its normalized inventory and must
    not be hidden merely because the supplemental models.dev profile also
    contains it.

    Pricing is returned by Hermes after querying the provider's live catalog.
    Values are already formatted as ``$/Mtok`` (or ``free``), which lets Amiba
    display the exact value the Hermes CLI shows without reinterpreting it.
    """

    fast = capabilities.get("fast")
    if isinstance(fast, bool):
        metadata.setdefault("fast_mode", fast)
        metadata.setdefault("fast_mode_source", "hermes-runtime")

    reasoning = capabilities.get("reasoning")
    if isinstance(reasoning, bool):
        metadata.setdefault("reasoning", reasoning)
        metadata.setdefault("capabilities_source", "hermes-inventory")

    price_fields = {
        "input": "input_price",
        "output": "output_price",
        "cache": "cache_read_price",
    }
    has_price = False
    for source_key, target_key in price_fields.items():
        value = pricing.get(source_key)
        if isinstance(value, str) and value.strip() and value.strip() != "?":
            metadata.setdefault(target_key, value.strip())
            has_price = True
    free = pricing.get("free")
    if isinstance(free, bool):
        metadata.setdefault("free", free)
        has_price = True
    if has_price:
        metadata.setdefault("pricing_source", "provider-live")


def build_provider_models_http_response(
    *, provider: str, force_refresh: bool
) -> Dict[str, Any]:
    manifest, _source = get_model_catalog_manifest(force_refresh=force_refresh)
    response = build_provider_models_response(
        provider, manifest=manifest, force_refresh=force_refresh
    )
    payload = {
        "providers": [
            {
                "slug": provider,
                "models": response.get("models", []),
            }
        ]
    }
    enrich_models_payload(payload)
    response["models"] = payload["providers"][0]["models"]
    return response


def _positive_number(value: Any) -> Optional[float]:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value > 0
    ):
        return float(value)
    return None


def model_info_metadata(info: Any) -> Dict[str, Any]:
    """Flatten Hermes ``ModelInfo`` into the catalog's JSON-safe metadata.

    The UI deliberately receives data, not presentation hints. Existing
    provider-specific metadata wins when this dictionary is merged so live
    provider limits/pricing can override the community registry.
    """
    if info is None:
        return {}

    metadata: Dict[str, Any] = {
        "reasoning": bool(getattr(info, "reasoning", False)),
        "tool_call": bool(getattr(info, "tool_call", False)),
        "vision": bool(
            info.supports_vision()
            if callable(getattr(info, "supports_vision", None))
            else False
        ),
        "temperature": bool(getattr(info, "temperature", False)),
        "structured_output": bool(getattr(info, "structured_output", False)),
        "open_weights": bool(getattr(info, "open_weights", False)),
        "interleaved_reasoning": bool(getattr(info, "interleaved", False)),
    }

    input_modalities = [
        str(value).strip()
        for value in (getattr(info, "input_modalities", ()) or ())
        if str(value).strip()
    ]
    output_modalities = [
        str(value).strip()
        for value in (getattr(info, "output_modalities", ()) or ())
        if str(value).strip()
    ]
    if input_modalities:
        metadata["input_modalities"] = input_modalities
    if output_modalities:
        metadata["output_modalities"] = output_modalities

    numeric_fields = {
        "context_window": getattr(info, "context_window", None),
        "max_input_tokens": getattr(info, "max_input", None),
        "max_output_tokens": getattr(info, "max_output", None),
        "input_price_per_mtok": getattr(info, "cost_input", None),
        "output_price_per_mtok": getattr(info, "cost_output", None),
        "cache_read_price_per_mtok": getattr(info, "cost_cache_read", None),
        "cache_write_price_per_mtok": getattr(info, "cost_cache_write", None),
    }
    for key, raw in numeric_fields.items():
        value = _positive_number(raw)
        if value is not None:
            metadata[key] = int(value) if value.is_integer() else value

    string_fields = {
        "model_family": getattr(info, "family", None),
        "knowledge_cutoff": getattr(info, "knowledge_cutoff", None),
        "release_date": getattr(info, "release_date", None),
        "model_status": getattr(info, "status", None),
    }
    for key, raw in string_fields.items():
        value = str(raw or "").strip()
        if value:
            metadata[key] = value

    return metadata


def enrich_models_payload(
    payload: Dict[str, Any],
    *,
    info_lookup: Optional[Callable[[str, str], Any]] = None,
    fast_mode_lookup: Optional[Callable[[str], bool]] = None,
) -> None:
    """Attach optional community metadata without mixing it into trusted data.

    ``build_models_payload`` intentionally emits compact model-id strings for
    terminal pickers. Amiba's provider settings are an inspection surface, so
    this adapter adds models.dev data under a provenance-bearing
    ``supplemental`` object. The model's top-level ``metadata`` remains reserved
    for fields supplied directly by the provider or Hermes itself.
    """
    if info_lookup is None:
        try:
            from agent.models_dev import get_model_info  # type: ignore

            info_lookup = get_model_info
        except Exception:
            info_lookup = None
    if fast_mode_lookup is None:
        try:
            from hermes_cli.models import model_supports_fast_mode  # type: ignore

            fast_mode_lookup = model_supports_fast_mode
        except Exception:
            fast_mode_lookup = None

    rows = payload.get("providers")
    if not isinstance(rows, list):
        return

    for row in rows:
        if not isinstance(row, dict):
            continue
        provider = str(row.get("slug") or "").strip()
        raw_models = row.get("models")
        if not isinstance(raw_models, list):
            continue
        row_capabilities = row.get("capabilities")
        row_pricing = row.get("pricing")

        enriched_models = []
        for raw_model in raw_models:
            if isinstance(raw_model, str):
                model_id = raw_model.strip()
                entry: Dict[str, Any] = {"id": model_id}
            elif isinstance(raw_model, dict):
                model_id = str(raw_model.get("id") or "").strip()
                entry = dict(raw_model)
                entry["id"] = model_id
            else:
                continue
            if not model_id:
                continue

            existing_metadata = entry.get("metadata")
            trusted_metadata = (
                dict(existing_metadata) if isinstance(existing_metadata, dict) else {}
            )
            inventory_capabilities = _mapping_entry(row_capabilities, model_id)
            inventory_pricing = _mapping_entry(row_pricing, model_id)
            _merge_hermes_inventory_metadata(
                trusted_metadata,
                capabilities=inventory_capabilities,
                pricing=inventory_pricing,
            )
            info = None
            if info_lookup is not None and provider:
                try:
                    info = info_lookup(provider, model_id)
                except Exception:
                    info = None
            supplemental_metadata = model_info_metadata(info)
            supplemental: Dict[str, Any] = {}
            if supplemental_metadata:
                supplemental = {
                    "source": "models.dev",
                    "metadata": supplemental_metadata,
                }
                display_name = str(getattr(info, "name", "") or "").strip()
                if display_name and display_name.lower() != model_id.lower():
                    supplemental["description"] = display_name

            if "fast_mode" not in trusted_metadata and fast_mode_lookup is not None:
                try:
                    trusted_metadata.setdefault(
                        "fast_mode", bool(fast_mode_lookup(model_id))
                    )
                    trusted_metadata.setdefault(
                        "fast_mode_source", "hermes-runtime"
                    )
                except Exception:
                    pass

            if trusted_metadata:
                entry["metadata"] = trusted_metadata
            else:
                entry.pop("metadata", None)
            if supplemental:
                entry["supplemental"] = supplemental
            else:
                entry.pop("supplemental", None)
            enriched_models.append(entry)

        row["models"] = enriched_models
