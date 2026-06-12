"""Coverage for /hermes/plugins: route mounted, list degrades, toggle logic."""

import sys

from amiba_backplane.runtime.features.hermes_proxy.plugins_routes.routes import apply_toggle
from amiba_backplane.runtime.features.hermes_proxy.plugins_routes.routes import (
    uninstall_refusal,
    drop_from_lists,
    pip_uninstall_cmd,
)
from amiba_backplane.runtime.features.hermes_proxy.plugins_routes.routes import (
    _remove_plugin_dir,
    _resolve_entrypoint_dist,
    _enrich_with_dist,
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


def test_remove_plugin_dir_unlinks_symlink_keeps_target(tmp_path):
    target = tmp_path / "real"
    target.mkdir()
    (target / "keep.txt").write_text("x")
    link = tmp_path / "link"
    link.symlink_to(target)

    assert _remove_plugin_dir(link) is True
    assert not link.exists()  # symlink gone
    assert target.exists()  # target preserved (NOT rmtree'd through the link)
    assert (target / "keep.txt").exists()


def test_remove_plugin_dir_rmtree_real_dir(tmp_path):
    d = tmp_path / "plug"
    d.mkdir()
    (d / "f").write_text("x")
    assert _remove_plugin_dir(d) is True
    assert not d.exists()


def test_remove_plugin_dir_missing_returns_false(tmp_path):
    assert _remove_plugin_dir(tmp_path / "nope") is False


def test_resolve_entrypoint_dist_unknown_returns_none():
    assert _resolve_entrypoint_dist("definitely-not-a-real-plugin-xyz") is None


def test_enrich_with_dist_only_touches_entrypoint():
    rows = [
        {"name": "a", "source": "bundled"},
        {"name": "b", "source": "entrypoint"},
    ]
    out = _enrich_with_dist(rows, resolver=lambda n: "dist-" + n)
    assert "dist" not in out[0]
    assert out[1]["dist"] == "dist-b"


def test_uninstall_route_mounted():
    app = build_http_app()
    paths = {r.resource.canonical for r in app.router.routes() if r.resource}
    assert "/hermes/plugins/uninstall" in paths


def test_uninstall_degrades_without_hermes_or_404():
    # Outside a Hermes process hermes_cli isn't importable -> 503. Inside one,
    # an unknown plugin -> 404. Either is acceptable; assert it never 200s for a
    # bogus name and never raises.
    status, body = plugins_routes._uninstall("definitely-not-a-real-plugin-xyz")
    assert status in (404, 503)
    assert body.get("ok") is not True
