import { describe, expect, it } from "vitest";
import { createSurfaceActivity } from "../surface-activity";
import { createPresentationCoordinator } from "../presentation-coordinator";
import type { SnapshotFrame } from "@amiba/app-runtime/core";

describe("engine activity projection", () => {
  it("uses terminal events, ignores other sessions and deduplicates repeated states", () => {
    const s = createSurfaceActivity("a");
    const read = s.activity.getSnapshot;
    s.event("b", { kind: "begin", assistantUiId: "x" });
    expect(read().phase).toBe("idle");
    s.event("a", { kind: "begin", assistantUiId: "x" });
    expect(read().phase).toBe("thinking");
    s.event("a", { kind: "chunk", text: "private" });
    expect(read().phase).toBe("responding");
    s.event("a", { kind: "done" });
    const completed = read();
    expect(completed.phase).toBe("completed");
    s.event("a", { kind: "done" });
    expect(read()).toBe(completed);
    expect(JSON.stringify(read())).not.toContain("private");
    s.event("a", { kind: "error", message: "private" });
    expect(read().phase).toBe("failed");
    s.event("a", { kind: "aborted" });
    expect(read().phase).toBe("interrupted");
  });
  it("keeps waiting until all waits resolve and tracks parallel tools", () => {
    const s = createSurfaceActivity("a");
    const event = (e: Parameters<typeof s.event>[1]) => s.event("a", e);
    event({ kind: "begin", assistantUiId: "x" });
    for (const id of ["1", "2"])
      event({
        kind: "toolProgress",
        event: { tool: "read", toolCallId: id, status: "running" },
      });
    event({
      kind: "questionRequest",
      request: { requestId: "q", questions: [] },
    });
    event({
      kind: "approvalRequest",
      request: { approvalId: "p", requestId: "p" },
    });
    event({ kind: "questionResolved", requestId: "q" });
    expect(s.activity.getSnapshot().phase).toBe("waiting");
    event({ kind: "approvalResolved", approvalId: "p" });
    expect(s.activity.getSnapshot().phase).toBe("tooling");
    event({
      kind: "toolProgress",
      event: { tool: "read", toolCallId: "1", status: "completed" },
    });
    expect(s.activity.getSnapshot().phase).toBe("tooling");
    event({
      kind: "toolProgress",
      event: {
        tool: "read",
        toolCallId: "2",
        status: "completed",
        error: true,
      },
    });
    expect(s.activity.getSnapshot().phase).toBe("thinking");
  });
  it("marks snapshot recovery separately from a fresh completion", () => {
    const s = createSurfaceActivity("a");
    s.snapshot({
      type: "snapshot",
      sessionId: "a",
      kind: "completed",
      state: { error: null, pendingApprovals: [], pendingQuestions: [] },
    } as unknown as SnapshotFrame);
    expect(s.activity.getSnapshot()).toMatchObject({
      phase: "completed",
      restored: true,
    });
    s.event("a", { kind: "begin", assistantUiId: "new" });
    s.event("a", { kind: "done" });
    expect(s.activity.getSnapshot()).toMatchObject({
      phase: "completed",
      restored: false,
    });
  });
});
describe("presentation election", () => {
  it("elects one claimant per group, respects priority and releases ownership", () => {
    const { coordinator } = createPresentationCoordinator();
    const low = coordinator.claim("pet", 0),
      high = coordinator.claim("pet", 10),
      unrelated = coordinator.claim("weather", 0);
    expect(low.getSnapshot()).toBe(false);
    expect(high.getSnapshot()).toBe(true);
    expect(unrelated.getSnapshot()).toBe(true);
    high.release();
    expect(high.getSnapshot()).toBe(false);
    expect(low.getSnapshot()).toBe(true);
    high.release();
    expect(low.getSnapshot()).toBe(true);
  });
  it("pauses all claims while hidden and resumes a single winner", () => {
    const store = createPresentationCoordinator();
    const a = store.coordinator.claim("pet"),
      b = store.coordinator.claim("pet");
    expect(a.getSnapshot()).toBe(true);
    expect(b.getSnapshot()).toBe(false);
    store.setVisible(false);
    expect(a.getSnapshot()).toBe(false);
    expect(b.getSnapshot()).toBe(false);
    store.setVisible(true);
    expect(a.getSnapshot()).toBe(true);
    expect(b.getSnapshot()).toBe(false);
  });
});

it("coordinates regional and global claims without hiding unrelated regions", () => {
  const root = createPresentationCoordinator(),
    left = root.scope(),
    right = root.scope();
  const overlay = root.coordinator.claim("pet", 0),
    a = left.coordinator.claim("pet", 20),
    b = right.coordinator.claim("pet", 10);
  expect(a.getSnapshot()).toBe(true);
  expect(b.getSnapshot()).toBe(false);
  expect(overlay.getSnapshot()).toBe(false);
  left.setVisible(false);
  expect(b.getSnapshot()).toBe(true);
  right.setVisible(false);
  expect(overlay.getSnapshot()).toBe(true);
  root.setVisible(false);
  expect(overlay.getSnapshot()).toBe(false);
  root.setVisible(true);
  expect(overlay.getSnapshot()).toBe(true);
  a.release();
  b.release();
  overlay.release();
});


it("projects restored Host activity without a synthetic turn while retaining interaction priority", () => {
  const source=createSurfaceActivity("restored");
  source.snapshot({type:"snapshot",sessionId:"restored",kind:"absent",hostRunning:true});
  expect(source.activity.getSnapshot()).toMatchObject({phase:"thinking",restored:true});
  source.snapshot({type:"snapshot",sessionId:"restored",kind:"absent",hostRunning:true,
    pendingQuestions:[{requestId:"question",questions:[]}]});
  expect(source.activity.getSnapshot().phase).toBe("waiting");
  source.snapshot({type:"snapshot",sessionId:"restored",kind:"absent",hostRunning:false});
  expect(source.activity.getSnapshot()).toMatchObject({phase:"idle",restored:true});
});
