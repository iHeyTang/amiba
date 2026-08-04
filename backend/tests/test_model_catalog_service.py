from types import SimpleNamespace

from amiba_backplane.runtime.features.hermes_proxy.settings.model_catalog_service import (
    enrich_models_payload,
)


def test_enrich_models_payload_separates_trusted_and_community_information():
    payload = {
        "providers": [
            {
                "slug": "example",
                "capabilities": {
                    "reasoner": {
                        "fast": True,
                        "reasoning": False,
                    }
                },
                "pricing": {
                    "reasoner": {
                        "input": "$1.25",
                        "output": "$4.50",
                        "cache": "$0.25",
                        "free": False,
                    }
                },
                "models": [
                    {
                        "id": "reasoner",
                        "metadata": {"context_window": 999_999},
                    }
                ],
            }
        ]
    }
    info = SimpleNamespace(
        name="Example Reasoner",
        reasoning=True,
        tool_call=True,
        supports_vision=lambda: True,
        temperature=True,
        structured_output=True,
        open_weights=False,
        interleaved={"field": "reasoning_content"},
        input_modalities=("text", "image", "pdf"),
        output_modalities=("text",),
        context_window=1_000_000,
        max_input=900_000,
        max_output=100_000,
        cost_input=1.25,
        cost_output=4.5,
        cost_cache_read=0.25,
        cost_cache_write=None,
        family="example-v2",
        knowledge_cutoff="2026-01",
        release_date="2026-02-03",
        status="beta",
    )

    enrich_models_payload(
        payload,
        info_lookup=lambda provider, model: info,
        fast_mode_lookup=lambda model: False,
    )

    model = payload["providers"][0]["models"][0]
    assert model["metadata"] == {
        "context_window": 999_999,
        "fast_mode": True,
        "fast_mode_source": "hermes-runtime",
        "reasoning": False,
        "capabilities_source": "hermes-inventory",
        "input_price": "$1.25",
        "output_price": "$4.50",
        "cache_read_price": "$0.25",
        "free": False,
        "pricing_source": "provider-live",
    }
    assert model["supplemental"] == {
        "source": "models.dev",
        "description": "Example Reasoner",
        "metadata": {
            "reasoning": True,
            "tool_call": True,
            "vision": True,
            "temperature": True,
            "structured_output": True,
            "open_weights": False,
            "interleaved_reasoning": True,
            "input_modalities": ["text", "image", "pdf"],
            "output_modalities": ["text"],
            "context_window": 1_000_000,
            "max_input_tokens": 900_000,
            "max_output_tokens": 100_000,
            "input_price_per_mtok": 1.25,
            "output_price_per_mtok": 4.5,
            "cache_read_price_per_mtok": 0.25,
            "model_family": "example-v2",
            "knowledge_cutoff": "2026-01",
            "release_date": "2026-02-03",
            "model_status": "beta",
        },
    }
