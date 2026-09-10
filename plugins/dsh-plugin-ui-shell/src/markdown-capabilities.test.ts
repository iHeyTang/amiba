import { Context } from "@deepseek-ai/cordis";
import {
  SkillRegistry,
  type SkillProvider,
  type SkillViewOptions,
} from "@deepseek-ai/dsh-skill";
import { expect, it, vi } from "vitest";
import {
  MarkdownCapabilityStore,
  MarkdownCapabilitiesService,
  withMarkdownCapability,
} from "./markdown-capabilities";
const requirement = { id: "chart", version: "1", languages: ["chart"] };
it("isolates sessions, requires matching version and languages, and expires reports", () => {
  const store = new MarkdownCapabilityStore();
  store.set("one", [requirement], 100);
  expect(store.supports("one", requirement, 101)).toBe(true);
  expect(store.supports("two", requirement, 101)).toBe(false);
  expect(store.supports("one", { ...requirement, version: "2" }, 101)).toBe(
    false,
  );
  expect(
    store.supports("one", { ...requirement, languages: ["plot"] }, 101),
  ).toBe(false);
  expect(store.supports("one", requirement, 600101)).toBe(false);
  store.set("one", [], 102);
  expect(store.supports("one", requirement, 103)).toBe(false);
  expect(() =>
    store.set("s", [{ ...requirement, languages: ["<script>"] }]),
  ).toThrow();
});
it("gates only associated skills through the real registry, preserving lazy loading and cache invalidation", async () => {
  vi.useFakeTimers();
  const ctx = new Context();
  const registry = await ctx.plugin(SkillRegistry);
  const capabilities = await ctx.plugin(MarkdownCapabilitiesService);
  const scope = { session: { id: "one" } };
  const options = { scope } as SkillViewOptions;
  const get = vi.fn(async (candidate: Parameters<SkillProvider["get"]>[0]) => ({
    ...candidate,
    content: "FULL SYNTAX BODY",
  }));
  const provider: SkillProvider = {
    name: "example",
    list: async () =>
      ["chart-skill", "search-skill"].map((name) => ({
        name,
        description: `Use ${name}`,
        provider: "example",
        source: "bundled",
        rank: 600,
        locator: name,
        invocation: { modelInvocable: true, userInvocable: true },
      })),
    get,
  };
  const dispose = ctx.skills.registerProvider((control) =>
    withMarkdownCapability(
      ctx,
      { "chart-skill": requirement },
      provider,
      control,
    ),
  );
  try {
    expect((await ctx.skills.list(options)).map((s) => s.name)).toEqual([
      "search-skill",
    ]);
    ctx.markdownCapabilities.report("one", [requirement]);
    const catalog = await ctx.skills.snapshot(options);
    expect(catalog.complete).toBe(true);
    expect(catalog.skills.map((s) => s.name)).toEqual([
      "chart-skill",
      "search-skill",
    ]);
    expect(JSON.stringify(catalog)).not.toContain("FULL SYNTAX BODY");
    expect(get).not.toHaveBeenCalled();
    expect((await ctx.skills.get("chart-skill", options))?.content).toBe(
      "FULL SYNTAX BODY",
    );
    expect(
      (
        await ctx.skills.list({
          scope: { session: { id: "two" } },
        } as SkillViewOptions)
      ).map((s) => s.name),
    ).toEqual(["search-skill"]);
    ctx.markdownCapabilities.report("one", []);
    expect(await ctx.skills.get("chart-skill", options)).toBeUndefined();
    expect(await ctx.skills.get("search-skill", options)).toBeTruthy();
    ctx.markdownCapabilities.report("one", [requirement]);
    await ctx.skills.list(options);
    await vi.advanceTimersByTimeAsync(600001);
    expect((await ctx.skills.list(options)).map((s) => s.name)).toEqual([
      "search-skill",
    ]);
    expect(await ctx.skills.get("chart-skill", options)).toBeUndefined();
    dispose();
    expect(await ctx.skills.list(options)).toEqual([]);
  } finally {
    await capabilities.dispose();
    await registry.dispose();
    vi.useRealTimers();
  }
});
