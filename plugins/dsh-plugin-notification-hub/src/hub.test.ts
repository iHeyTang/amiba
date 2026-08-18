import { describe, expect, it, vi } from "vitest";

import type { Context } from "@deepseek-ai/cordis";

import { AmibaNotificationHub } from "./hub.js";

function harness() {
  const warn = vi.fn();
  const ctx = { logger: { warn } } as unknown as Context;
  return { hub: new AmibaNotificationHub(ctx), warn };
}

describe("AmibaNotificationHub.post", () => {
  it("accepts a minimal notification and stamps identity", () => {
    const { hub } = harness();
    const { id } = hub.post({ title: "Backup finished", source: "demo" });
    expect(id).toMatch(/^ntf_/u);
    const [stored] = hub.list();
    expect(stored).toMatchObject({
      id,
      title: "Backup finished",
      kind: "info",
      source: "demo",
    });
    expect(stored!.body).toBeUndefined();
    expect(stored!.sessionId).toBeUndefined();
    expect(typeof stored!.timestamp).toBe("number");
  });

  it("keeps body, kind and sessionId when supplied", () => {
    const { hub } = harness();
    hub.post({
      title: " Deploy failed ",
      body: "Exit code 1",
      kind: "error",
      sessionId: "sess-1",
      source: "ci",
    });
    expect(hub.list()[0]).toMatchObject({
      title: "Deploy failed",
      body: "Exit code 1",
      kind: "error",
      sessionId: "sess-1",
      source: "ci",
    });
  });

  it("rejects a missing or blank title", () => {
    const { hub } = harness();
    expect(() =>
      hub.post({ source: "demo" } as never),
    ).toThrow();
    expect(() => hub.post({ title: "   ", source: "demo" })).toThrow();
    expect(hub.list()).toHaveLength(0);
  });

  it("rejects a missing source and an unknown kind", () => {
    const { hub } = harness();
    expect(() => hub.post({ title: "hello" } as never)).toThrow();
    expect(() =>
      hub.post({ title: "hello", source: "demo", kind: "loud" as never }),
    ).toThrow();
  });

  it("rejects an over-long title and unknown extra fields", () => {
    const { hub } = harness();
    expect(() =>
      hub.post({ title: "x".repeat(161), source: "demo" }),
    ).toThrow();
    expect(() =>
      hub.post({ title: "ok", source: "demo", extra: true } as never),
    ).toThrow();
  });
});

describe("AmibaNotificationHub ring", () => {
  it("retains only the most recent 100 notifications", () => {
    const { hub } = harness();
    for (let index = 0; index < 120; index += 1) {
      hub.post({ title: `notification ${index}`, source: "demo" });
    }
    const retained = hub.list();
    expect(retained).toHaveLength(100);
    expect(retained[0]!.title).toBe("notification 20");
    expect(retained[99]!.title).toBe("notification 119");
  });
});

describe("AmibaNotificationHub sinks", () => {
  it("delivers each accepted post to registered sinks", () => {
    const { hub } = harness();
    const sink = vi.fn();
    hub.registerSink(sink);
    const { id } = hub.post({ title: "hello", source: "demo" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ id, title: "hello" });
  });

  it("stops delivering after the disposer runs", () => {
    const { hub } = harness();
    const sink = vi.fn();
    const dispose = hub.registerSink(sink);
    dispose();
    hub.post({ title: "hello", source: "demo" });
    expect(sink).not.toHaveBeenCalled();
  });

  it("contains a throwing sink and still delivers to the others", () => {
    const { hub, warn } = harness();
    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    hub.registerSink(failing);
    hub.registerSink(healthy);
    hub.post({ title: "hello", source: "demo" });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects registering the same sink twice", () => {
    const { hub } = harness();
    const sink = vi.fn();
    hub.registerSink(sink);
    expect(() => hub.registerSink(sink)).toThrow(/duplicate/u);
  });
});
