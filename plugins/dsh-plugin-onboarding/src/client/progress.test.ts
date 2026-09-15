import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import SettingsProvider, { settingsNamespace } from "@deepseek-ai/dsh-settings";
import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
import * as plugin from "../index.js";
import { createProgressStore } from "./progress.js";
class MemorySettings extends SettingsProvider {
  readonly writable = true;
  protected async load() {
    return {};
  }
  protected async persist() {}
}
describe("DSH-backed progress", () => {
  it("persists per-step completion with revisions, survives plugin reload, and releases its namespace", async () => {
    const ctx = new Context();
    const settings = ctx.plugin(MemorySettings);
    await settings;
    let fiber = ctx.plugin(plugin);
    await fiber;
    const api = {
      settings: {
        describe: async () => ({
          result: {
            ok: true,
            value: { writable: true, namespaces: ctx.settings.describe() },
          },
        }),
        mutate: async (input: any) => ({
          result: {
            ok: true,
            value: await ctx.settings.mutate(
              input.ns,
              input.ops,
              input.expectedRevision,
            ),
          },
        }),
      },
    } as unknown as ClientRemote;
    const store = createProgressStore(api);
    try {
      expect(await store.read()).toEqual({
        completed: [],
        skipped: [],
        finished: false,
      });
      await Promise.all([
        store.mark("models"),
        store.mark("connectors"),
        store.mark("models"),
      ]);
      expect(await store.read()).toEqual({
        completed: ["models", "connectors"],
        skipped: [],
        finished: false,
      });
      await store.mark("models", true);
      expect((await store.read()).skipped).toEqual(["models"]);
      await store.mark("models");
      await store.finish();
      await fiber.dispose();
      expect(ctx.settings.describe()).toEqual([]);
      fiber = ctx.plugin(plugin);
      await fiber;
      expect(await createProgressStore(api).read()).toEqual({
        completed: ["models", "connectors"],
        skipped: [],
        finished: true,
      });
    } finally {
      await fiber.dispose();
      await settings.dispose();
    }
  });
});
