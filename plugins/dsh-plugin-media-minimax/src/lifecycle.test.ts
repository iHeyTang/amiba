import { expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, { LlmAdapter } from "@deepseek-ai/dsh-llm";
import SettingsProvider from "@deepseek-ai/dsh-settings";
import { MediaRegistry } from "@amiba/dsh-plugin-media";
import * as plugin from "./index.js";
class Settings extends SettingsProvider {
  readonly writable = true;
  protected async load() {
    return {};
  }
  protected async persist() {}
}
class Adapter extends LlmAdapter {
  async *stream(): AsyncGenerator<never> {}
}
it("adds and removes only media capabilities while preserving the official LLM route", async () => {
  const ctx = new Context();
  const llm = ctx.plugin(LlmRuntime);
  await llm;
  const settings = ctx.plugin(Settings);
  await settings;
  const credentials = ctx.provide("credentials", {
    resolve: async () => undefined,
  } as never);
  const registry = new MediaRegistry();
  const media = ctx.provide("amibaMedia", registry as never);
  const fiber = ctx.plugin(plugin);
  await fiber;
  try {
    expect(registry.list()).toEqual([]);
    const registration = ctx.llm.registerAdapter(["minimax-cn"], new Adapter());
    expect(registry.list()).toEqual(["minimax-cn"]);
    await fiber.dispose();
    expect(registry.list()).toEqual([]);
    expect(ctx.llm.listProviders().map((p) => p.id)).toContain("minimax-cn");
    registration();
  } finally {
    await fiber.dispose();
    media();
    credentials();
    await settings.dispose();
    await llm.dispose();
  }
});
