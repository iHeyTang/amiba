import { Context } from "@deepseek-ai/cordis";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";
import { expect, it, vi } from "vitest";
import { requiredFeatures } from "./index.js";
import { installSharedConversationAccess, sharedConversationSeed, sharedConversationBinding, SHARED_CONVERSATION_FEATURE } from "./shared-conversation.js";

it("keeps privacy restrictions when a session is resumed or forked", () => {
  const origin = { plugin: "lark", entry: "account", scope: "shared:group" };
  const events = sharedConversationSeed("original", origin);
  expect(sharedConversationBinding({ events })?.origin).toEqual(origin);
  expect(requiredFeatures({ id: "fork", events })).toContainEqual({ sessionId: "fork", plugin: SHARED_CONVERSATION_FEATURE, version: 1 });
  expect(() => sharedConversationBinding({ events: [...events, ...sharedConversationSeed("other", { ...origin, scope: "private" })] })).toThrow("Conflicting");
});
it("blocks private tools including later scoped tools in the real DSH runtime", async () => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const runtime = await ctx.plugin(ToolRuntime, {});
  let root!: Context;
  const injection = await ctx.inject(["tools", "systemPrompt"], child => { root = child; });
  const key = { session: { id: "shared", events: sharedConversationSeed("shared", { plugin: "lark", entry: "account", scope: "shared:group" }) } };
  const scope = createScope(root, key);
  const execute = vi.fn(async () => "private-result");
  const register = (host: Context, name: string) => host.tools.register({ name, description: name, parameters: { type: "object", properties: {} }, output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] }, execute });
  const removeHistory = register(root, "conversation_search_history");
  const removePrivate = register(root, "mcp__private__read");
  const removePrivatePrompt = root.systemPrompt.section({ name: "private-context", order: 100, text: "PRIVATE_WORKSPACE_SECRET" });
  const removePrivateContext = root.systemPrompt.context({ name: "private-runtime", order: 100, text: "PRIVATE_RUNTIME_SECRET" });
  const disposeAccess = installSharedConversationAccess(scope.ctx);
  const removeLate = register(scope.ctx, "spawn_agent");
  try {
    const assembly = await scope.ctx.systemPrompt.assemble({ scope: key, agent: key as never });
    expect(JSON.stringify(assembly)).not.toContain("PRIVATE_WORKSPACE_SECRET");
    expect(JSON.stringify(assembly)).not.toContain("PRIVATE_RUNTIME_SECRET");
    expect(ctx.tools.schemas(key).map(tool => tool.name)).not.toContain("mcp__private__read");
    for (const name of ["mcp__private__read", "spawn_agent", "run_code"]) {
      const result = await ctx.tools.execute({ name, agent: key as never, arguments: {}, callId: "call" as never, signal: new AbortController().signal });
      expect(result.isError).toBe(true);
    }
    expect(execute).not.toHaveBeenCalled();
    const allowed = await ctx.tools.execute({ name: "conversation_search_history", agent: key as never, arguments: {}, callId: "safe" as never, signal: new AbortController().signal });
    expect(allowed.isError).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    removeLate(); disposeAccess(); removePrivateContext(); removePrivatePrompt(); removePrivate(); removeHistory();
    await scope.dispose(); await injection.dispose(); await runtime.dispose(); await prompt.dispose();
  }
});
