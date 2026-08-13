from types import SimpleNamespace

from amiba_backplane.runtime.features.hermes_proxy.settings import (
    provider_connection_service as connection_service,
)
from amiba_backplane.runtime.features.hermes_proxy.settings import (
    provider_credentials_service as service,
)


def _profile(auth_type: str):
    return SimpleNamespace(
        auth_type=auth_type,
        base_url="https://api.example.com",
    )


def _stub_connection(*args, **kwargs):
    return {
        "status": "none",
        "active_method": "",
        "methods": [],
        "service": {"status": "not_checked", "reason": ""},
    }


def test_endpoint_default_and_placeholder_share_runtime_registry_source(monkeypatch):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["DEEPSEEK_API_KEY"],
    )
    monkeypatch.setattr(
        service,
        "base_url_env_var_for_slug",
        lambda slug: "DEEPSEEK_BASE_URL",
    )
    monkeypatch.setattr(
        service,
        "provider_endpoint_definition_for_slug",
        lambda slug: {
            "default_base_url": "https://api.deepseek.com/v1",
            "override_env_var": "DEEPSEEK_BASE_URL",
        },
    )
    monkeypatch.setattr(service, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(
        service,
        "get_provider_profile",
        # Deliberately disagree: the UI must not read this duplicate value.
        lambda slug: SimpleNamespace(
            auth_type="api_key",
            base_url="https://wrong-profile.example/v1",
        ),
    )
    monkeypatch.setattr(service, "build_provider_connection", _stub_connection)
    monkeypatch.delenv("DEEPSEEK_BASE_URL", raising=False)

    response = service.read_provider_credentials_response("deepseek")
    url_field = next(
        field for field in response["fields"] if field["kind"] == "url"
    )

    assert response["endpoint"] == {
        "default_base_url": "https://api.deepseek.com/v1",
        "override_env_var": "DEEPSEEK_BASE_URL",
        "override_base_url": "",
        "effective_base_url": "https://api.deepseek.com/v1",
        "source": "default",
    }
    assert url_field["placeholder"] == response["endpoint"]["default_base_url"]


def test_saved_provider_url_override_is_the_effective_endpoint(monkeypatch):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["DEEPSEEK_API_KEY"],
    )
    monkeypatch.setattr(
        service,
        "base_url_env_var_for_slug",
        lambda slug: "DEEPSEEK_BASE_URL",
    )
    monkeypatch.setattr(
        service,
        "provider_endpoint_definition_for_slug",
        lambda slug: {
            "default_base_url": "https://api.deepseek.com/v1",
            "override_env_var": "DEEPSEEK_BASE_URL",
        },
    )
    monkeypatch.setattr(
        service,
        "read_dotenv_as_dict",
        lambda path: {"DEEPSEEK_BASE_URL": "https://deepseek-proxy.example/v1"},
    )
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(
        service, "get_provider_profile", lambda slug: _profile("api_key")
    )
    monkeypatch.setattr(service, "build_provider_connection", _stub_connection)

    response = service.read_provider_credentials_response("deepseek")

    assert response["endpoint"]["override_base_url"] == (
        "https://deepseek-proxy.example/v1"
    )
    assert response["endpoint"]["effective_base_url"] == (
        "https://deepseek-proxy.example/v1"
    )
    assert response["endpoint"]["source"] == "saved"


def test_provider_credentials_return_maskable_ambient_secrets_and_report_source(
    monkeypatch,
):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
    )
    monkeypatch.setattr(service, "base_url_env_var_for_slug", lambda slug: "")
    monkeypatch.setattr(service, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(service, "get_provider_profile", lambda slug: _profile("copilot"))
    monkeypatch.setenv("GH_TOKEN", "ambient-secret")
    monkeypatch.setattr(
        connection_service,
        "inspect_provider_auth_sources",
        lambda slug, verify_service=False: {
            "runtime_logged_in": True,
            "runtime_source": "GH_TOKEN",
            "external_sources": [],
            "pool_sources": [],
            "service": {"status": "verified", "reason": ""},
        },
    )

    response = service.read_provider_credentials_response(
        "copilot",
        verify_service=True,
    )

    assert [field["key"] for field in response["fields"]] == [
        "COPILOT_GITHUB_TOKEN",
        "GH_TOKEN",
        "GITHUB_TOKEN",
    ]
    gh_field = response["fields"][1]
    assert gh_field["value"] == "ambient-secret"
    assert gh_field["origin"] == "environment"
    assert gh_field["configured"] is True
    assert response["connection"]["active_method"] == "env:GH_TOKEN"
    assert response["connection"]["status"] == "verified"
    assert response["auth_hint"] == "Uses your GitHub Copilot subscription."


def test_copilot_identity_requires_service_verification_and_reuses_result(
    monkeypatch,
):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["GH_TOKEN"],
    )
    monkeypatch.setattr(service, "base_url_env_var_for_slug", lambda slug: "")
    monkeypatch.setattr(service, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(
        service,
        "get_provider_profile",
        lambda slug: _profile("copilot"),
    )
    monkeypatch.setenv("GH_TOKEN", "identity-with-unknown-entitlement")
    service_status = {"status": "not_checked", "reason": ""}

    monkeypatch.setattr(
        connection_service,
        "inspect_provider_auth_sources",
        lambda slug, verify_service=False: {
            "runtime_logged_in": True,
            "runtime_source": "GH_TOKEN",
            "external_sources": [],
            "pool_sources": [],
            "service": dict(service_status),
        },
    )

    unverified = service.read_provider_credentials_response(
        "copilot",
        verify_service=False,
    )
    assert unverified["connection"]["status"] == "verification_required"

    service_status.update(status="verified")
    verified = service.read_provider_credentials_response(
        "copilot",
        verify_service=True,
    )
    assert verified["connection"]["status"] == "verified"

    service_status.update(status="not_checked")
    cached = service.read_provider_credentials_response(
        "copilot",
        verify_service=False,
    )
    assert cached["connection"]["status"] == "verified"


def test_anthropic_explicit_api_key_suppresses_detected_claude_code(monkeypatch):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
        ],
    )
    monkeypatch.setattr(service, "base_url_env_var_for_slug", lambda slug: "")
    monkeypatch.setattr(
        service,
        "read_dotenv_as_dict",
        lambda path: {"ANTHROPIC_API_KEY": "saved-api-key"},
    )
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(
        service,
        "get_provider_profile",
        lambda slug: _profile("api_key"),
    )
    monkeypatch.setattr(
        connection_service,
        "inspect_provider_auth_sources",
        lambda slug, verify_service=False: {
            "runtime_logged_in": True,
            "runtime_source": "",
            "external_sources": ["claude_code"],
            "pool_sources": [],
            "service": {"status": "not_checked", "reason": ""},
        },
    )

    response = service.read_provider_credentials_response("anthropic")
    connection = response["connection"]

    assert response["fields"][0]["value"] == "saved-api-key"
    assert response["fields"][0]["configured"] is True
    assert response["fields"][0]["origin"] == "saved"
    assert connection["active_method"] == "env:ANTHROPIC_API_KEY"
    assert connection["status"] == "configured"
    claude_code = next(
        method
        for method in connection["methods"]
        if method["id"] == "external:claude_code"
    )
    assert claude_code["status"] == "detected"


def test_copilot_pool_login_is_reported_as_the_effective_connection(monkeypatch):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
    )
    monkeypatch.setattr(service, "base_url_env_var_for_slug", lambda slug: "")
    monkeypatch.setattr(service, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(
        service,
        "get_provider_profile",
        lambda slug: _profile("copilot"),
    )
    monkeypatch.setattr(
        connection_service,
        "inspect_provider_auth_sources",
        lambda slug, verify_service=False: {
            "runtime_logged_in": True,
            "runtime_source": "pool:copilot-device",
            "external_sources": [],
            "pool_sources": [
                {
                    "id": "copilot-device",
                    "source": "device_code",
                    "auth_type": "oauth",
                    "label": "Hermes Copilot login",
                    "priority": 0,
                }
            ],
            "service": {"status": "verified", "reason": ""},
        },
    )

    response = service.read_provider_credentials_response(
        "copilot",
        verify_service=True,
    )
    connection = response["connection"]

    assert connection["active_method"] == "pool:copilot-device"
    assert connection["status"] == "verified"
    active = next(
        method
        for method in connection["methods"]
        if method["id"] == connection["active_method"]
    )
    assert active["label"] == "Hermes Copilot login"
    assert active["configured"] is True
    assert all(field["value"] == "" for field in response["fields"])


def test_named_profile_does_not_expose_default_profile_api_key(monkeypatch):
    monkeypatch.setattr(
        service,
        "env_var_names_for_slug",
        lambda slug: ["DEEPSEEK_API_KEY"],
    )
    monkeypatch.setattr(service, "base_url_env_var_for_slug", lambda slug: "")
    monkeypatch.setattr(service, "read_dotenv_as_dict", lambda path: {})
    monkeypatch.setattr(service, "plugin_dotenv_path", lambda: object())
    monkeypatch.setattr(service, "current_profile_id", lambda: "researcher")
    monkeypatch.setattr(service, "is_default_profile", lambda: False)
    monkeypatch.setattr(
        service,
        "get_provider_profile",
        lambda slug: _profile("api_key"),
    )
    monkeypatch.setenv("DEEPSEEK_API_KEY", "default-profile-secret")
    monkeypatch.setattr(
        connection_service,
        "inspect_provider_auth_sources",
        lambda slug, verify_service=False: {
            "runtime_logged_in": True,
            "runtime_source": "DEEPSEEK_API_KEY",
            "external_sources": [],
            "pool_sources": [
                {
                    "id": "env-deepseek",
                    "source": "env:DEEPSEEK_API_KEY",
                    "auth_type": "api_key",
                    "priority": 0,
                    "scope": "shared",
                }
            ],
            "service": {"status": "not_checked", "reason": ""},
        },
    )

    response = service.read_provider_credentials_response("deepseek")

    assert response["profile"] == "researcher"
    assert response["fields"][0]["value"] == ""
    assert response["fields"][0]["origin"] == "none"
    assert response["fields"][0]["configured"] is False
    assert response["connection"]["status"] == "none"
    assert response["connection"]["active_scope"] == "none"


def test_named_profile_write_never_applies_secret_to_process_env(monkeypatch):
    recorded = {}
    monkeypatch.setattr(
        service,
        "allowed_credential_keys_for_provider",
        lambda slug: ["OPENROUTER_API_KEY"],
    )
    monkeypatch.setattr(service, "is_default_profile", lambda: False)

    def merge(values, *, apply_process=True):
        recorded["values"] = values
        recorded["apply_process"] = apply_process

    monkeypatch.setattr(service, "merge_dotenv_file_and_apply", merge)

    written = service.merge_credentials_for_provider(
        "openrouter",
        {"OPENROUTER_API_KEY": "profile-key"},
    )

    assert written == ["OPENROUTER_API_KEY"]
    assert recorded == {
        "values": {"OPENROUTER_API_KEY": "profile-key"},
        "apply_process": False,
    }
