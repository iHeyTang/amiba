import { MediaRegistry } from "@amiba/dsh-plugin-media";
import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SettingsProvider, { settingsNamespace } from "@deepseek-ai/dsh-settings";
import * as token from "./index.js";

class MemorySettings extends SettingsProvider {
  readonly writable = true;
  protected async load() {
    return {};
  }
  protected async persist() {}
}
describe("TokenDance standard plugin lifecycle", () => {
  it("loads in official DSH, reacts to settings, and unregisters on plugin unload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected catalog fetch"));
    const ctx = new Context();
    const settings = ctx.plugin(MemorySettings);
    await settings;
    const llm = ctx.plugin(LlmRuntime);
    await llm;
    const credentials = ctx.provide("credentials", {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
    });
    const registry = new MediaRegistry();
    const mediaDispose = ctx.provide("amibaMedia", registry as Context["amibaMedia"]);
    const fiber = ctx.plugin(token, token.Config());
    await fiber;
    try {
      expect(registry.list()).toEqual([]);
      expect(ctx.llm.listProviders()).toEqual([]);
      expect(ctx.llm.listConfigurableProviders()).toEqual([
        {
          provider: "tokendance",
          displayName: "TokenDance",
          settingsNs: "llm-tokendance",
          settingsPath: ["providers", "tokendance"],
          declared: false,
        },
      ]);
      const descriptor = ctx.settings
        .describe()
        .find((d) => d.ns === "llm-tokendance")!;
      await ctx.settings.mutate(
        settingsNamespace("llm-tokendance"),
        [
          {
            op: "set",
            path: ["providers", "tokendance"],
            value: {
              refreshCatalog: false,
              models: [
                {
                  id: "local-custom",
                  description: "Custom model description",
                  api: "openai-responses",
                  contextWindow: 8192,
                },
              ],
            },
          },
        ],
        descriptor.revision,
      );
      // Settings watchers run asynchronously in commit order.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await vi.waitFor(() => expect(registry.list()).toEqual(["tokendance"]));
      expect(ctx.llm.listProviders()).toEqual([
        { id: "tokendance", name: "TokenDance" },
      ]);
      expect(ctx.llm.listConfigurableProviders()[0]?.declared).toBe(true);
      expect(await ctx.llm.listModels("tokendance")).toMatchObject([
        { id: "local-custom", provider: "tokendance", description: "Custom model description" },
      ]);
      expect(
        await ctx.llm.resolveModelInfo("tokendance", "local-custom"),
      ).toMatchObject({ context: { contextWindow: 8192 } });
      await ctx.settings.mutate(
        settingsNamespace("llm-tokendance"),
        [{ op: "unset", path: ["providers", "tokendance"] }],
        ctx.settings.describe().find((d) => d.ns === "llm-tokendance")!
          .revision,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(registry.list()).toEqual([]);
      expect(ctx.llm.listProviders()).toEqual([]);
      expect(ctx.llm.listConfigurableProviders()[0]?.declared).toBe(false);
      expect(registry.list()).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      await fiber.dispose();
      expect(registry.list()).toEqual([]);
      expect(ctx.llm.listProviders()).toEqual([]);
      expect(ctx.llm.listConfigurableProviders()).toEqual([]);
      expect(ctx.settings.describe()).toEqual([]);
    } finally {
      await fiber.dispose();
      await settings.dispose();
      await llm.dispose();
      mediaDispose();
      credentials();
      fetchSpy.mockRestore();
    }
  });
});
