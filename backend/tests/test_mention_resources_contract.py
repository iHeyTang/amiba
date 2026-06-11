"""`mention_resources()` surfaces the per-type `requires_query` / `empty_hint`.

The composer relies on these: a `requires_query` type with no query shows its
`empty_hint` as the category's empty state instead of vanishing.
"""

from pathlib import Path

from amiba_backplane.runtime.mention_sources import loader
from amiba_backplane.runtime.mention_sources.loader import LoadedSource, LoadResult


def test_requires_query_and_empty_hint_passthrough(monkeypatch):
    meta = {
        "mention_resources": [
            {
                "type": "doc",
                "label": "飞书文档",
                "group": "飞书文档",
                "requires_query": True,
                "empty_hint": "输入关键词搜索飞书文档",
            },
            {"type": "chat", "label": "飞书群", "group": "飞书群聊"},  # no flag
        ]
    }
    monkeypatch.setattr(
        loader,
        "_state",
        LoadResult(loaded=[LoadedSource(name="lark", path=Path("/x"), meta=meta)]),
    )

    by_type = {r["type"]: r for r in loader.mention_resources()}

    assert by_type["doc"]["requires_query"] is True
    assert by_type["doc"]["empty_hint"] == "输入关键词搜索飞书文档"
    # Absent flag → False, and no hint.
    assert by_type["chat"]["requires_query"] is False
    assert by_type["chat"]["empty_hint"] is None
