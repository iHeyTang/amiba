import { describe, expect, it, vi } from "vitest";
import { hasScopedMemory, scopedMemoryContext } from "./scoped-memory.js";

describe("scoped memory integration", () => {
  it("skips automatic recall/capture for stewards and their tasks, preserving ordinary memory", async () => {
    const callbacks = new Map<string, (...args: any[]) => unknown>();
    const ctx = {
      reflect: {
        get: () => ({ ownsSession: (id: string) => id === "managed" }),
      },
      on: (name: string, fn: (...args: any[]) => unknown) => {
        callbacks.set(name, fn);
        return () => callbacks.delete(name);
      },
    };
    const scoped = scopedMemoryContext(ctx as never);
    const capture = vi.fn(),
      recall = vi.fn((_payload, next) => next());
    scoped.on("session/event", capture);
    scoped.on("agent/pre-step", recall);
    const next = vi.fn();
    for (const session of [
      { id: "managed" },
      {
        id: "steward",
        events: [
          { type: "amiba/session-feature", data: { plugin: "amiba-steward" } },
        ],
      },
    ]) {
      callbacks.get("session/event")!(session, {});
      await callbacks.get("agent/pre-step")!({ agent: { session } }, next);
    }
    expect(capture).not.toHaveBeenCalled();
    expect(recall).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
    callbacks.get("session/event")!({ id: "ordinary" }, {});
    await callbacks.get("agent/pre-step")!(
      { agent: { session: { id: "ordinary" } } },
      next,
    );
    expect(capture).toHaveBeenCalledOnce();
    expect(recall).toHaveBeenCalledOnce();
  });
  it("retains the memory boundary in copied steward history even without the plugin", () => {
    const ctx = { reflect: { get: () => undefined } } as never;
    expect(
      hasScopedMemory(ctx, {
        id: "fork",
        events: [
          {
            type: "amiba/session-feature",
            data: { plugin: "amiba-steward", sessionId: "original" },
          },
        ],
      }),
    ).toBe(true);
    expect(hasScopedMemory(ctx, { id: "ordinary" })).toBe(false);
  });
});
