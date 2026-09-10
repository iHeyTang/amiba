import {describe, expect, it} from "vitest";
import {Context} from "@deepseek-ai/cordis";
import SettingsProvider from "@deepseek-ai/dsh-settings";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as plugin from "./index.js";
class MemorySettings extends SettingsProvider {
  readonly writable = true;
  protected async load() {return {};}
  protected async persist() {}
}
describe("UI-only host contribution", () => {
  it("loads with settings alone, migrates display preferences, and unloads cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-native-model-ui-"));
    await writeFile(join(root, "registry.json"), JSON.stringify({"officialModelUi.v1": {migrated: true, hiddenProviders: ["community"], hiddenModels: {community: ["model"]}}}));
    const ctx = new Context(); const settings = ctx.plugin(MemorySettings); await settings;
    const fiber = ctx.plugin(plugin, {root});
    try {
      await fiber;
      expect(ctx.settings.describe().map(d => d.ns)).toEqual(["amiba-model-ui"]);
      expect(ctx.settings.describe()[0].value).toEqual({hiddenProviders: ["community"], hiddenModels: {community: ["model"]}});
      // No llm/credentials/custom remote is required by the UI host plugin.
      await fiber.dispose(); expect(ctx.settings.describe()).toEqual([]);
    } finally {await fiber.dispose(); await settings.dispose(); await rm(root, {recursive: true, force: true});}
  });
});
