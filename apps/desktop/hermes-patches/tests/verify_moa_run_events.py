"""Build-time contract check for Amiba's Hermes MoA runs patch."""

from __future__ import annotations

import sys
from pathlib import Path


class ImmediateLoop:
    """Minimal loop contract used by Hermes's thread-safe queue bridge."""

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
    APIServerAdapter = api_server.APIServerAdapter

    adapter = APIServerAdapter.__new__(APIServerAdapter)
    adapter._run_streams = {}
    adapter._run_statuses = {}
    run_id = "amiba_patch_contract"
    sink = EventSink()
    adapter._run_streams[run_id] = sink

    callback = adapter._make_run_event_callback(run_id, ImmediateLoop())
    secret = "sk-proj-abcdef1234567890abcdef1234567890abcdef12"
    callback("moa.progress", "reference-model", moa_refs_done=1, moa_refs_total=2)
    callback(
        "moa.reference",
        "reference-model",
        f"reference output containing {secret}",
        moa_index=1,
        moa_count=2,
    )
    callback(
        "moa.phase",
        "aggregator-model",
        moa_phase="aggregator",
        moa_refs_done=2,
        moa_refs_total=2,
    )
    callback("moa.aggregating", "aggregator-model", moa_ref_count=2)

    events = sink.events
    assert len(events) == 4, events
    assert [event["event"] for event in events] == [
        "moa.progress",
        "moa.reference",
        "moa.phase",
        "moa.aggregating",
    ]
    assert events[0]["refs_done"] == 1
    assert events[0]["refs_total"] == 2
    assert events[1]["index"] == 1
    assert events[1]["count"] == 2
    assert secret not in events[1]["text"]
    assert events[2]["phase"] == "aggregator"
    assert events[2]["aggregator"] == "aggregator-model"
    assert events[3]["ref_count"] == 2


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_moa_run_events.py <patched-hermes-source>")
    verify(Path(sys.argv[1]).resolve())
