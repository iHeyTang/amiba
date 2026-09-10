// @vitest-environment node
import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { expect, it, vi } from "vitest";
import { McpToolSurface, mcpPublicToolName } from "./tool-surface.js";

it("enforces independent tool grants through the actual DSH registry and execution pipeline", async () => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const tools = await ctx.plugin(ToolRuntime, {});
  let scopeCtx!: Context;
  const injection = await ctx.inject(["tools"], injected => { scopeCtx = injected; });
  const surface = new McpToolSurface("documents");
  const calls: string[] = [];
  const register = (rawName: string) => surface.register({
    name: mcpPublicToolName("documents", rawName), description: rawName,
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
    async execute() { calls.push(rawName); return rawName; },
  });
  const readName = mcpPublicToolName("documents", "read");
  const writeName = mcpPublicToolName("documents", "write");
  const readerKey = {}, writerKey = {}, ordinaryKey = {};
  const reader = createScope(scopeCtx, readerKey);
  const writer = createScope(scopeCtx, writerKey);
  const ordinary = createScope(scopeCtx, ordinaryKey);
  const readerLease = new AbortController(), writerLease = new AbortController();
  const call = (name: string, agent: object, args: unknown = { text: "fixture" }) => ctx.tools.execute({
    name, agent: agent as never, arguments: args, callId: "fixture" as never,
    signal: new AbortController().signal,
  });
  try {
    let unregisterRead = register("read");
    register("write");
    expect(ctx.tools.schemas()).toEqual([]);
    surface.attach(reader.ctx, ["read"], readerLease.signal);
    surface.attach(writer.ctx, ["write"], writerLease.signal);
    expect(ctx.tools.schemas(readerKey).map(t => t.name)).toEqual([readName]);
    expect(ctx.tools.schemas(writerKey).map(t => t.name)).toEqual([writeName]);
    expect(ctx.tools.schemas(ordinaryKey)).toEqual([]);
    expect((await call(writeName, readerKey)).isError).toBe(true);
    expect((await call(readName, ordinaryKey)).isError).toBe(true);
    expect(calls).toEqual([]);
    expect((await call(readName, readerKey, { text: 5 })).isError).toBe(true);
    expect(calls).toEqual([]);
    expect((await call(readName, readerKey)).isError).toBe(false);
    expect((await call(writeName, writerKey)).isError).toBe(false);

    // Re-discovery does not expand a consumer's grant, even when new tools arrive.
    unregisterRead();
    unregisterRead = register("read");
    register("delete");
    expect(ctx.tools.schemas(readerKey).map(t => t.name)).toEqual([readName]);
    readerLease.abort();
    expect(ctx.tools.schemas(readerKey)).toEqual([]);
    expect((await call(writeName, writerKey)).isError).toBe(false);
    expect((await call(readName, readerKey)).isError).toBe(true);
    unregisterRead();
  } finally {
    readerLease.abort(); writerLease.abort(); surface.dispose();
    reader.dispose(); writer.dispose(); ordinary.dispose();
    await injection.dispose();
    await tools.dispose(); await prompt.dispose();
  }
});

it("cancels an in-flight call on lease revocation without changing its caller's signal", async () => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const tools = await ctx.plugin(ToolRuntime, {});
  const surface = new McpToolSurface("documents");
  const lease = new AbortController();
  const caller = new AbortController();
  let started = false;
  surface.register({ name: mcpPublicToolName("documents", "read"), description: "read",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "string" }, render: () => [] },
    async execute(_args, exec) {
      started = true;
      await new Promise<void>(resolve => exec.signal.addEventListener("abort", () => resolve(), { once: true }));
      return "late result";
    },
  });
  surface.attach(ctx, ["read"], lease.signal);
  try {
    const result = ctx.tools.execute({ name: mcpPublicToolName("documents", "read"),
      arguments: {}, callId: "fixture" as never, signal: caller.signal });
    await vi.waitFor(() => expect(started).toBe(true));
    lease.abort();
    expect((await result).isError).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  } finally {
    lease.abort(); surface.dispose(); await tools.dispose(); await prompt.dispose();
  }
});
