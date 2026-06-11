"""`list_sources()` treats the registry as the source of truth.

Regression: when a local source was moved/renamed, its symlink under
``~/.hermes/mention-sources/`` went dangling. The loader silently skipped it
(``is_dir()`` follows the broken link), so the UI showed "nothing installed"
while ``install`` refused with "already exists" (``is_symlink()`` still true).
Such registry entries must be *listed* with a hint, not vanish.
"""

import json

from amiba_backplane.runtime.mention_sources import loader, manager
from amiba_backplane.runtime.mention_sources.loader import LoadedSource, LoadResult


def _point_sources_dir(monkeypatch, root):
    """Redirect both modules' view of the sources dir + registry to *root*."""
    monkeypatch.setattr(loader, "USER_SOURCES_DIR", root)
    monkeypatch.setattr(manager, "USER_SOURCES_DIR", root)
    monkeypatch.setattr(manager, "_REGISTRY_PATH", root / ".registry.json")
    monkeypatch.setattr(loader, "_state", LoadResult())


def test_dangling_symlink_listed_as_missing(monkeypatch, tmp_path):
    sources = tmp_path / "mention-sources"
    sources.mkdir()
    gone = tmp_path / "moved-away"  # deliberately never created
    (sources / "lark").symlink_to(gone, target_is_directory=True)
    (sources / ".registry.json").write_text(
        json.dumps({"lark": {"method": "path", "path": str(gone)}})
    )
    _point_sources_dir(monkeypatch, sources)

    out = manager.list_sources()
    row = next((s for s in out["sources"] if s["name"] == "lark"), None)
    assert row is not None, "a registry entry must be listed even when its target is gone"
    assert row["status"] == "missing"
    assert row["error"], "missing rows must carry a human hint"
    assert row["has_search"] is False
    assert row["origin"] == {"method": "path", "path": str(gone)}


def test_loaded_source_listed_as_loaded(monkeypatch, tmp_path):
    sources = tmp_path / "mention-sources"
    sources.mkdir()
    _point_sources_dir(monkeypatch, sources)
    loader._state.loaded.append(
        LoadedSource(
            name="ok",
            path=sources / "ok",
            meta={"version": "1.0", "description": "fine"},
            search=lambda *a, **k: None,
        )
    )

    out = manager.list_sources()
    row = next(s for s in out["sources"] if s["name"] == "ok")
    assert row["status"] == "loaded"
    assert row["has_search"] is True
    assert row["version"] == "1.0"
