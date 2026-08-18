import { afterEach, describe, expect, it, vi } from "vitest";

const PLATFORM_ADAPTER_KEY = Symbol.for("@amiba/app-runtime/platform-adapter");

afterEach(() => {
  const registry = globalThis as unknown as Record<PropertyKey, unknown>;
  delete registry[PLATFORM_ADAPTER_KEY];
  vi.resetModules();
});

describe("PlatformAdapter registry", () => {
  it("shares the host adapter across bundled module copies", async () => {
    const firstCopy = await import("./index");
    const adapter = {
      kind: "desktop" as const,
      windowChrome: { topBarHeightPx: 40, leftInsetPx: 96 },
      storage: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
        watch: () => () => {},
      },
      shell: { openExternal: async () => {} },
    };

    firstCopy.setPlatform(adapter);
    vi.resetModules();
    const secondCopy = await import("./index");

    expect(secondCopy.hasPlatform()).toBe(true);
    expect(secondCopy.getPlatform()).toBe(adapter);
    expect(secondCopy.getPlatform().windowChrome?.leftInsetPx).toBe(96);
  });
});
