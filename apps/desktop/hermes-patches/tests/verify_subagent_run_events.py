"""Build-time contract check for Amiba's delegated-agent runs patch."""

from __future__ import annotations

import sys
from pathlib import Path


class ImmediateLoop:
    @staticmethod
    def call_soon_threadsafe(callback, *args) -> None:
        callback(*args)


class EventSink:
    def __init__(self) -> None:
        self.events: list[dict] = []

    def put_nowait(self, event: dict) -> None:
        self.events.append(event)


def verify(source: Path) -> None:
    sys.path.insert(0, str(source))
    from gateway.platforms import api_server

    assert Path(api_server.__file__).resolve().is_relative_to(source)
    adapter = api_server.APIServerAdapter.__new__(api_server.APIServerAdapter)
    adapter._run_streams = {}
    adapter._run_statuses = {}
    run_id = "amiba_subagent_patch_contract"
    sink = EventSink()
    adapter._run_streams[run_id] = sink

    callback = adapter._make_run_event_callback(run_id, ImmediateLoop())
    secret = "sk-proj-abcdef1234567890abcdef1234567890abcdef12"
    common = {
        "subagent_id": "child-1",
        "child_session_id": "session-child-1",
        "goal": "inspect the workspace",
        "task_index": 0,
        "task_count": 1,
    }
    callback("subagent.spawn_requested", preview="queued", **common)
    callback("subagent.start", preview="started", model="test-model", **common)
    callback("subagent.tool", "terminal", f"running {secret}", **common)
    callback("subagent.progress", preview="tests are running", **common)
    callback(
        "subagent.complete",
        preview="done",
        status="completed",
        input_tokens=100,
        output_tokens=40,
        files_written=["src/app.ts"],
        **common,
    )

    assert [event["event"] for event in sink.events] == [
        "subagent.spawn_requested",
        "subagent.start",
        "subagent.tool",
        "subagent.progress",
        "subagent.complete",
    ]
    assert sink.events[2]["tool_name"] == "terminal"
    assert secret not in sink.events[2]["preview"]
    assert sink.events[4]["input_tokens"] == 100
    assert sink.events[4]["files_written"] == ["src/app.ts"]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_subagent_run_events.py <patched-hermes-source>")
    verify(Path(sys.argv[1]).resolve())
