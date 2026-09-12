import { describe, expect, it, vi } from "vitest";
import { apply } from "./index.js";
function context(
  call = vi.fn(async (name: string) =>
    name === "amiba_native_attach" ? "lease-1" : { content: [] },
  ),
) {
  let provider: any, dispose: (() => Promise<void>) | undefined;
  const unregister = vi.fn();
  const ctx = {
    amibaRuntimeGateway: { call },
    amibaBrowser: {
      registerProvider: vi.fn((value) => {
        provider = value;
        return unregister;
      }),
    },
    effect(factory: () => () => Promise<void>) {
      dispose = factory();
    },
  };
  return {
    ctx,
    call,
    unregister,
    provider: () => provider,
    dispose: () => dispose!(),
  };
}
describe("browser native lifecycle", () => {
  it("attaches before publishing tools and removes the provider before native detach", async () => {
    const c = context();
    await apply(c.ctx as never);
    expect(c.call.mock.calls[0]?.[0]).toBe("amiba_native_attach");
    const signal = new AbortController().signal;
    await c
      .provider()
      .call("amiba_browser_open", { url: "https://example.com" }, signal, {
        sessionId: "background",
      });
    expect(c.call).toHaveBeenLastCalledWith(
      "amiba_native_call",
      {
        lease: "lease-1",
        method: "amiba_browser_open",
        input: { url: "https://example.com" },
      },
      signal,
      { sessionId: "background" },
    );
    await c.dispose();
    expect(c.unregister).toHaveBeenCalledOnce();
    expect(c.call).toHaveBeenLastCalledWith(
      "amiba_native_detach",
      { lease: "lease-1" },
      expect.any(AbortSignal),
    );
  });
  it("cleans an attachment that finishes after unload without publishing tools", async () => {
    let finish!: (lease: string) => void;
    const call = vi.fn(async (name: string) =>
      name === "amiba_native_attach"
        ? await new Promise<string>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    const c = context(call as never);
    const starting = apply(c.ctx as never);
    await c.dispose();
    finish("late");
    await starting;
    expect(c.ctx.amibaBrowser.registerProvider).not.toHaveBeenCalled();
    expect(call).toHaveBeenLastCalledWith(
      "amiba_native_detach",
      { lease: "late" },
      expect.any(AbortSignal),
    );
  });
  it("cleans by instance when an attach acknowledgement is lost", async () => {
    const call = vi.fn(async (name: string) => {
      if (name === "amiba_native_attach") throw new Error("timeout");
    });
    const c = context(call as never);
    await expect(apply(c.ctx as never)).rejects.toThrow("timeout");
    expect(c.ctx.amibaBrowser.registerProvider).not.toHaveBeenCalled();
    expect(call).toHaveBeenLastCalledWith(
      "amiba_native_detach",
      expect.objectContaining({
        instanceId: expect.any(String),
        packageName: "@amiba/dsh-plugin-browser-provider-electron",
      }),
      expect.any(AbortSignal),
    );
  });
});
