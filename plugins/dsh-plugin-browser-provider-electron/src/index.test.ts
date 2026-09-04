import { describe, expect, it, vi } from "vitest";

import { apply } from "./index.js";

describe("dsh-plugin-browser-provider-electron", () => {
  it("registers only an execution provider and delegates through the gateway", async () => {
    let provider: {
      id: string;
      call(
        operation: string,
        args: Record<string, unknown>,
        signal: AbortSignal,
        context: { sessionId?: string },
      ): Promise<unknown>;
    } | undefined;
    const call = vi.fn(async () => ({ content: [] }));
    const unregister = vi.fn();
    const ctx = {
      amibaRuntimeGateway: { call },
      amibaBrowser: {
        registerProvider(value: typeof provider) {
          provider = value;
          return unregister;
        },
      },
      effect(factory: () => () => void) {
        factory();
      },
    };

    apply(ctx as never);
    expect(provider?.id).toBe("electron-visible");
    const signal = new AbortController().signal;
    await provider?.call("amiba_browser_open", { url: "https://example.com" }, signal, {
      sessionId: "session-background",
    });
    // The owning session has to reach Electron main, or a background task's
    // tab lands in whichever workbench the user is looking at.
    expect(call).toHaveBeenCalledWith(
      "amiba_browser_open",
      { url: "https://example.com" },
      signal,
      { sessionId: "session-background" },
    );

    await provider?.call("amiba_browser_open", { url: "https://example.com" }, signal, {});
    expect(call).toHaveBeenLastCalledWith(
      "amiba_browser_open",
      { url: "https://example.com" },
      signal,
      {},
    );
  });
});
