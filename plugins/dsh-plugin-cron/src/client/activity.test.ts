import { describe, expect, it, vi } from "vitest";
import { reconcileRuns, runUnread, type SessionActivity } from "./activity.js";
import type { CronTaskView } from "../types.js";

const run = { sessionId: "run", startedAt: 100, finishedAt: 200 };
const task = { runs: [run] } as CronTaskView;
const viewer = (patch: Partial<SessionActivity> = {}): SessionActivity => ({
  sessions: [],
  visibleSessionId: "",
  markRead: vi.fn(),
  markUnread: vi.fn(),
  ...patch,
});

describe("cron unread reconciliation", () => {
  it("recovers unseen results even before the session reaches the sidebar", async () => {
    const activity = viewer();
    expect(runUnread(run, activity)).toBe(true);
    await reconcileRuns([task], activity);
    expect(activity.markUnread).toHaveBeenCalledWith("run", 200);
  });
  it("does not clear unread on entering the cron panel or replay an acknowledged result", async () => {
    const activity = viewer({ sessions: [{ id: "run", unread: true }] });
    await reconcileRuns([task], activity);
    expect(activity.markRead).not.toHaveBeenCalled();
    const read = viewer({ sessions: [{ id: "run", readAt: 250 }] });
    expect(runUnread(run, read)).toBe(false);
    await reconcileRuns([task], read);
    expect(read.markUnread).not.toHaveBeenCalled();
  });
  it("acknowledges a visible result and detects completion after its initial read", async () => {
    const activity = viewer({
      visibleSessionId: "run",
      sessions: [{ id: "run", readAt: 150 }],
    });
    expect(runUnread(run, activity)).toBe(false);
    await reconcileRuns([task], activity);
    expect(activity.markRead).toHaveBeenCalledWith("run", 200);
    expect(runUnread(run, { ...activity, visibleSessionId: "" })).toBe(true);
  });
  it("excludes archived conversations from the menu badge", async () => {
    const activity = viewer({
      sessions: [{ id: "run", archived: true, unread: true }],
    });
    expect(runUnread(run, activity)).toBe(false);
    await reconcileRuns([task], activity);
    expect(activity.markUnread).not.toHaveBeenCalled();
  });
});
