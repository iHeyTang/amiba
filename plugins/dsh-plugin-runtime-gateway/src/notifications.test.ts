import { describe, expect, it, vi } from "vitest";

import type { AmibaNotification } from "@amiba/dsh-plugin-notification-hub";

import { desktopNotificationSink, NOTIFY_OPERATION } from "./notifications.js";

function notification(
  overrides: Partial<AmibaNotification> = {},
): AmibaNotification {
  return {
    id: "ntf_test_1",
    title: "Backup finished",
    kind: "info",
    source: "demo",
    timestamp: 1_720_000_000_000,
    ...overrides,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("desktopNotificationSink", () => {
  it("forwards the notification over the gateway notify operation", () => {
    const call = vi.fn(async () => ({ delivered: true }));
    const warn = vi.fn();
    const sink = desktopNotificationSink({ call }, warn);
    const posted = notification({ body: "42 files", sessionId: "sess-1" });

    sink(posted);

    expect(call).toHaveBeenCalledTimes(1);
    const [operation, payload, signal] = call.mock.calls[0]! as unknown as [
      string,
      Record<string, unknown>,
      AbortSignal,
    ];
    expect(operation).toBe(NOTIFY_OPERATION);
    expect(payload).toEqual({ ...posted });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(warn).not.toHaveBeenCalled();
  });

  it("contains delivery failures as a warning instead of throwing", async () => {
    const call = vi.fn(async () => {
      throw new Error("gateway offline");
    });
    const warn = vi.fn();
    const sink = desktopNotificationSink({ call }, warn);

    expect(() => sink(notification())).not.toThrow();
    await settled();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("ntf_test_1");
    expect(String(warn.mock.calls[0]![0])).toContain("gateway offline");
  });
});
