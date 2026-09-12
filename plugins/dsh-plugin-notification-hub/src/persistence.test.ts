import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { AmibaNotificationHub } from "./hub.js";
it("retains unread notices and acknowledgements across restarts without any display plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "notifications-"));
  const ctx = { logger: { warn: vi.fn() } } as unknown as Context;
  try {
    const hub = new AmibaNotificationHub(ctx, root);
    const first = hub.post({
      title: "Task",
      source: "test",
      sessionId: "s",
      key: "one",
    });
    hub.markSessionsRead([{ sessionId: "s", readAt: 0 }]);
    expect(hub.list()[0].dismissedAt).toBeUndefined();
    hub.dismiss(first.id);
    hub.post({ title: "Reminder", source: "schedule" });
    const restored = new AmibaNotificationHub(ctx, root);
    expect(restored.list()).toHaveLength(2);
    expect(restored.list()[0].dismissedAt).toBeDefined();
    expect(restored.list()[1].dismissedAt).toBeUndefined();
    expect(
      restored.post({
        title: "Task",
        source: "test",
        sessionId: "s",
        key: "one",
      }),
    ).toEqual(first);
    expect(restored.list()).toHaveLength(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not publish a mutation when its durable write fails", () => {
  const root = mkdtempSync(join(tmpdir(), "notifications-write-"));
  const hub = new AmibaNotificationHub(
    { logger: { warn: vi.fn() } } as unknown as Context,
    root,
  );
  const listener = vi.fn();
  hub.subscribe(listener);
  rmSync(root, { recursive: true });
  try {
    expect(() => hub.post({ title: "Not saved", source: "test" })).toThrow();
    expect(hub.list()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  } finally {
    hub.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

it("never persists transient execution or resurrects it on restart", () => {
  const root = mkdtempSync(join(tmpdir(), "activity-"));
  const ctx = { logger: { warn: vi.fn() } } as unknown as Context;
  try {
    const hub = new AmibaNotificationHub(ctx, root);
    hub.setSessionActivity("a", "Live task", "thinking");
    hub.post({ title: "Completed task", source: "conversation", status: "completed" });
    expect(hub.list()).toHaveLength(2);
    const restored = new AmibaNotificationHub(ctx, root);
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0].title).toBe("Completed task");
    hub.dispose(); restored.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
