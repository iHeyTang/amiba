import type { AmibaNotification } from "@amiba/dsh-plugin-notification-hub/model";
import { describe, it, expect } from "vitest";
import { petMessages, placeDesktopMessage } from "./desktop-message.js";
describe("desktop message placement", () => {
  it("flips below at the top and clamps to the right edge", () => {
    const result = placeDesktopMessage(
      { x: 900, y: 0, width: 90, height: 90 },
      { width: 1000, height: 800 },
      90,
    );
    expect(result.above).toBe(false);
    expect(result.top).toBe(102);
    expect(result.left + result.width).toBeLessThanOrEqual(988);
    expect(
      placeDesktopMessage(
        { x: 0, y: 710, width: 90, height: 90 },
        { width: 1000, height: 800 },
        90,
      ).above,
    ).toBe(true);
  });
});

it("keeps read live sessions, prioritizes requests and removes duplicate waiting activity", () => {
  const base = { title: "Task", kind: "info" as const, source: "conversation", timestamp: 1 };
  const rows: AmibaNotification[] = [
    { ...base, id: "live-a", sessionId: "a", status: "tooling" as const, activity: true, readAt: 10 },
    { ...base, id: "live-b", sessionId: "b", status: "thinking" as const, activity: true },
    { ...base, id: "approval", sessionId: "a", status: "waiting" as const },
    { ...base, id: "done", sessionId: "c", status: "completed" as const, timestamp: 20 },
  ];
  expect(petMessages(rows).map(n => n.id)).toEqual(["approval", "live-b", "done"]);
  rows[2] = { ...rows[2], resolvedAt: 30 };
  expect(petMessages(rows).map(n => n.id)).toEqual(["live-a", "live-b", "done"]);
});

it("shows an unresolved live wait even when its notice has already been read", () => {
  const live = { id: "live", activity: true, sessionId: "s", source: "conversation", kind: "info" as const,
    title: "Task", timestamp: 1, status: "waiting" as const };
  expect(petMessages([live, { ...live, id: "notice", activity: false, readAt: 2 }]).map(n => n.id)).toEqual(["live"]);
});
