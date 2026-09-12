import { describe, expect, it } from "vitest";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";
import { compactionUpdate, upsertCompactionTimeline } from "./compaction";
import type { AssistantTimelineItem } from "../protocol";
import type { DshSessionEvent } from "./index";

const event = (
  type: string,
  seq: number,
  data: Record<string, unknown> = {},
): DshSessionEvent => ({
  type,
  seq,
  time: seq * 100,
  data: { compactionId: "c1", ...data },
});
const lifecycle = [
  event("compaction/start", 3),
  event("compaction/summary", 4, {
    summary: [{ type: "text", text: "Keep the user's requirements." }],
    shadowedSeqs: [1, 2],
    shadowedTokenCount: 12345,
  }),
  event("compaction/end", 6),
];

describe("compaction presentation", () => {
  it("projects identical live and durable records without exposing checkpoint user messages", () => {
    const bridge = new DshAmibaEventBridge();
    const timeline: AssistantTimelineItem[] = [];
    for (const source of lifecycle) {
      const [mapped] = bridge.accept({
        rpcId: "mux",
        payload: { type: "session/event", sessionId: "s", event: source },
      });
      expect(mapped?.sessionId).toBe("s");
      if (mapped?.event.kind === "compaction")
        upsertCompactionTimeline(timeline, mapped.event.event);
    }
    const rows = projectRuntimeSessionHistory([
      { event: event("turn/start", 0, { turn: 1 }) },
      ...lifecycle.map((event) => ({ event })),
      {
        event: event("user/message", 5, {
          source: {
            kind: "plugin",
            plugin: "dsh-compaction-basic",
            compactionId: "c1",
          },
          content: [{ type: "text", text: "private checkpoint" }],
        }),
      },
      { event: event("turn/end", 7) },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assistantTimeline).toEqual(timeline);
    expect(timeline).toEqual([
      {
        kind: "compaction",
        id: "dsh:compaction:c1",
        compaction: {
          compactionId: "c1",
          status: "completed",
          startedAt: 300,
          endedAt: 600,
          summary: "Keep the user's requirements.",
          shadowedItemCount: 2,
          shadowedTokenCount: 12345,
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("private checkpoint");
  });

  it("keeps position and published snapshots stable through updates and duplicate start events", () => {
    const timeline: AssistantTimelineItem[] = [
      { kind: "text", id: "before", text: "before" },
    ];
    upsertCompactionTimeline(timeline, compactionUpdate(lifecycle[0]!)!);
    const published = timeline[1];
    timeline.push({ kind: "text", id: "after", text: "after" });
    for (const source of [...lifecycle.slice(1), lifecycle[0]!])
      upsertCompactionTimeline(timeline, compactionUpdate(source)!);
    expect(timeline.map((item) => item.kind)).toEqual([
      "text",
      "compaction",
      "text",
    ]);
    expect(published).toMatchObject({ compaction: { status: "running" } });
    expect(timeline[1]).toMatchObject({ compaction: { status: "completed" } });
  });

  it("preserves a failure and handles partial history with no start event", () => {
    const rows = projectRuntimeSessionHistory([
      {
        event: event("compaction/end", 9, {
          error: [{ name: "Error", message: "summary timed out" }],
        }),
      },
    ]);
    expect(rows[0]?.assistantTimeline?.[0]).toMatchObject({
      compaction: { status: "failed", error: "summary timed out" },
    });
  });

  it("settles an unfinished compaction on turn end and retains repeated compactions", () => {
    const rows = projectRuntimeSessionHistory([
      ...lifecycle.map((event) => ({ event })),
      { event: event("compaction/start", 7, { compactionId: "c2" }) },
      { event: event("turn/end", 8, { reason: { kind: "aborted" } }) },
    ]);
    expect(rows[0]?.assistantTimeline).toMatchObject([
      { compaction: { compactionId: "c1", status: "completed" } },
      { compaction: { compactionId: "c2", status: "interrupted" } },
    ]);
  });

  it("does not invent completion from a summary or malformed lifecycle", () => {
    const timeline: AssistantTimelineItem[] = [];
    upsertCompactionTimeline(timeline, compactionUpdate(lifecycle[1]!)!);
    expect(timeline[0]).toMatchObject({ compaction: { status: "running" } });
    expect(
      compactionUpdate(event("compaction/start", 0, { compactionId: "" })),
    ).toBeNull();
    expect(compactionUpdate(event("compaction/other", 0))).toBeNull();
  });
});
