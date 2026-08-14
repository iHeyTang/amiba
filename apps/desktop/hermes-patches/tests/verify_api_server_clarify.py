"""Build-time contract check for Amiba's API-server Clarify bridge."""

from __future__ import annotations

import inspect
import sys
from pathlib import Path


def verify(source: Path) -> None:
    sys.path.insert(0, str(source))
    import toolsets
    from gateway.platforms import api_server

    assert Path(api_server.__file__).resolve().is_relative_to(source)
    assert "clarify" in toolsets.TOOLSETS["hermes-api-server"]["tools"]

    adapter = api_server.APIServerAdapter.__new__(api_server.APIServerAdapter)
    routes = {(method, path) for method, path, _handler in adapter._http_route_table()}
    assert ("POST", "/v1/runs/{run_id}/clarify") in routes

    run_source = inspect.getsource(api_server.APIServerAdapter._handle_runs)
    assert "agent.clarify_callback = _clarify_callback" in run_source
    assert '"event": "clarify.request"' in run_source

    response_source = inspect.getsource(
        api_server.APIServerAdapter._handle_run_clarify
    )
    assert "resolve_gateway_clarify" in response_source
    assert '"clarify.responded"' in response_source


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_api_server_clarify.py <patched-hermes-source>")
    verify(Path(sys.argv[1]).resolve())
