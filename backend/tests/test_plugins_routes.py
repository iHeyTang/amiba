"""Coverage for /hermes/plugins: route mounted, list degrades, toggle logic."""

import sys

from amiba_backplane.runtime.features.hermes_proxy.plugins_routes.routes import apply_toggle
from amiba_backplane.runtime.features.hermes_proxy.plugins_routes.routes import (
    uninstall_refusal,
    drop_from_lists,
    pip_uninstall_cmd,
)
from amiba_backplane.runtime.features.hermes_proxy.plugins_routes import routes as plugins_routes
from amiba_backplane.runtime.http_app import build_http_app


def test_routes_mounted():
    app = build_http_app()
    paths = {r.resource.canonical for r in app.router.routes() if r.resource}
    assert "/hermes/plugins" in paths
    assert "/hermes/plugins/enable" in paths
    assert "/hermes/plugins/disable" in paths


def test_list_returns_none_or_list():
    # Contract: None (hermes_cli not importable) or a list (in a Hermes process).
    # handle_list wraps None -> {"plugins": []} either way.
    result = plugins_routes._list_plugins()
    assert result is None or isinstance(result, list)


def test_apply_toggle_enable():
    enabled, disabled = apply_toggle(["a"], ["b"], "b", True)
    assert "b" in enabled and "b" not in disabled  # moved deny->allow
    assert "a" in enabled


def test_apply_toggle_disable():
    enabled, disabled = apply_toggle(["a", "b"], [], "b", False)
    assert "b" not in enabled and "b" in disabled  # removed from allow, added to deny


def test_apply_toggle_idempotent():
    e, d = apply_toggle(["a"], [], "a", True)
    assert e == ["a"] and d == []
    e, d = apply_toggle([], ["x"], "x", False)
    assert e == [] and d == ["x"]


def test_apply_toggle_does_not_mutate_inputs():
    src_e, src_d = ["a"], ["b"]
    apply_toggle(src_e, src_d, "c", True)
    assert src_e == ["a"] and src_d == ["b"]


def test_uninstall_refusal_bundled_and_project():
    assert uninstall_refusal("bundled") is not None
    assert uninstall_refusal("project") is not None


def test_uninstall_refusal_allows_user_and_entrypoint():
    assert uninstall_refusal("user") is None
    assert uninstall_refusal("entrypoint") is None
    assert uninstall_refusal("") is None  # unknown handled later, not here


def test_drop_from_lists_removes_from_both():
    en, dis = drop_from_lists(["a", "b"], ["b", "c"], "b")
    assert en == ["a"] and dis == ["c"]


def test_drop_from_lists_absent_is_noop():
    en, dis = drop_from_lists(["a"], ["c"], "z")
    assert en == ["a"] and dis == ["c"]


def test_pip_uninstall_cmd_shape():
    assert pip_uninstall_cmd("pkg-x") == [sys.executable, "-m", "pip", "uninstall", "-y", "pkg-x"]
