// @vitest-environment node
import { Context } from "@deepseek-ai/cordis";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";
import { expect, it } from "vitest";

it("tracks real scoped overrides and restores inherited ownership after disposal", async () => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const runtime = await ctx.plugin(ToolRuntime, {});
  const definition = {
    name: "search", description: "Search", parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: {} }, render: () => [] },
    execute: async () => ({}),
  };
  const shipped = await ctx.plugin({ name: "shipped", inject: ["tools"], apply(owner: Context) { owner.tools.register(definition as never); } });
  const key = {};
  const scope = createScope(ctx, key);
  const extension = await scope.ctx.plugin({ name: "extension", inject: ["tools"], apply(owner: Context) { owner.tools.register(definition as never); } });
  try {
    expect(ctx.tools.registrationContext("search")?.fiber.uid).toBe(shipped.uid);
    expect(ctx.tools.registrationContext("search", key)?.fiber.uid).toBe(extension.uid);
    expect(ctx.tools.get("search")).not.toBe(ctx.tools.get("search", key));
    expect(ctx.tools.schemas(key)).toEqual(ctx.tools.schemas());
    await extension.dispose();
    expect(ctx.tools.registrationContext("search", key)?.fiber.uid).toBe(shipped.uid);
    await shipped.dispose();
    expect(ctx.tools.registrationContext("search", key)).toBeUndefined();
  } finally {
    await extension.dispose(); await shipped.dispose(); scope.dispose(); await runtime.dispose(); await prompt.dispose();
  }
});
