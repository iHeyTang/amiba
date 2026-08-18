import { describe, expect, it, vi } from "vitest";

import { AmibaBrowserService } from "./index.js";

describe("dsh-plugin-browser-core", () => {
  it("publishes schemas only while a provider is registered", async () => {
    const definitions = new Map<string, Record<string, unknown>>();
    const sources = new Map<string, Record<string, unknown>>();
    const ctx = {
      tools: {
        register(definition: Record<string, unknown>) {
          definitions.set(String(definition.name), definition);
          return () => definitions.delete(String(definition.name));
        },
      },
      attachments: {
        imageLimits: { maxImagesPerMessage: 4, maxMessageImageBytes: 20_000 },
        validateImage: vi.fn(),
        saveImage: vi.fn(),
      },
    };
    const catalog = {
      register(name: string, source: Record<string, unknown>) {
        sources.set(name, source);
        return () => sources.delete(name);
      },
    };
    const service = new AmibaBrowserService(ctx as never, catalog as never);
    expect(definitions.size).toBe(0);

    const call = vi.fn(async () => ({ content: [{ type: "text", text: "opened" }] }));
    const unregister = service.registerProvider({
      id: "test",
      name: "Test Browser",
      call,
    });
    expect([...definitions.keys()].sort()).toEqual([
      "amiba_browser_click",
      "amiba_browser_console",
      "amiba_browser_open",
      "amiba_browser_press",
      "amiba_browser_screenshot",
      "amiba_browser_scroll",
      "amiba_browser_snapshot",
      "amiba_browser_type",
    ]);
    expect(sources.get("amiba_browser_open")).toMatchObject({
      packageName: "@amiba/dsh-plugin-browser-core",
      executionTarget: "external-process",
    });

    const definition = definitions.get("amiba_browser_open") as {
      execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>;
    };
    await definition.execute(
      { url: "https://example.com" },
      { signal: new AbortController().signal },
    );
    expect(call).toHaveBeenCalledWith(
      "amiba_browser_open",
      { url: "https://example.com" },
      expect.any(AbortSignal),
    );

    unregister();
    expect(definitions.size).toBe(0);
    expect(sources.size).toBe(0);
  });
});
