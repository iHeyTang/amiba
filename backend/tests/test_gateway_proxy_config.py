from amiba_backplane.runtime.features.gateway_proxy import routes


def test_gateway_base_defaults_to_standard_hermes_port(monkeypatch):
    monkeypatch.delenv("AMIBA_HERMES_GATEWAY_BASE", raising=False)
    assert routes._gateway_base() == "http://127.0.0.1:8642"


def test_gateway_base_uses_desktop_managed_runtime(monkeypatch):
    monkeypatch.setenv(
        "AMIBA_HERMES_GATEWAY_BASE", "http://127.0.0.1:18642/"
    )
    assert routes._gateway_base() == "http://127.0.0.1:18642"
