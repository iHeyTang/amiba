import { expect, it } from "vitest";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";
import { upsertRetryTimeline } from "./retry";
import type { AssistantTimelineItem } from "../protocol";

it("replays each retry once, retaining order and prior published snapshots", () => {
  const bridge = new DshAmibaEventBridge();
  const timeline: AssistantTimelineItem[] = [];
  const events = [
    {
      type: "llm/retry",
      seq: 1,
      time: 100,
      data: { retryId: "r", retry: 1, delayMs: 500, step: 1 },
    },
    {
      type: "llm/retry-started",
      seq: 2,
      time: 600,
      data: { retryId: "r", retry: 1, step: 1 },
    },
    {
      type: "llm/retry",
      seq: 3,
      time: 700,
      data: { retryId: "r", retry: 2, delayMs: 1000, step: 1 },
    },
  ];
  let published: AssistantTimelineItem | undefined;
  for (const event of events) {
    for (const mapped of bridge.accept({
      rpcId: "mux",
      payload: { type: "session/event", sessionId: "s", event },
    })) {
      if (mapped.event.kind === "retry")
        upsertRetryTimeline(timeline, mapped.event.event);
    }
    published ??= timeline[0];
  }
  expect(published).toMatchObject({ retry: { status: "waiting" } });
  expect(timeline).toHaveLength(2);
  expect(timeline[0]).toMatchObject({
    retry: { status: "started", delayMs: 500 },
  });
  const rows = projectRuntimeSessionHistory(events.map((event) => ({ event })));
  expect(rows[0]?.assistantTimeline).toEqual(timeline);
  for (const mapped of bridge.accept({
    rpcId: "mux",
    payload: { type: "session/event", sessionId: "s", event: events[0]! },
  })) {
    if (mapped.event.kind === "retry")
      upsertRetryTimeline(timeline, mapped.event.event);
  }
  expect(timeline[0]).toMatchObject({ retry: { status: "started" } });
});
