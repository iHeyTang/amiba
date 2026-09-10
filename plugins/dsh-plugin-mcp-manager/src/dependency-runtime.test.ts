// @vitest-environment node
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { provideMcpConnection } from "./provider-connection.js";
import { useMcpRequirement } from "./plugin-dependency.js";
import { DshMcpManager } from "./manager.js";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";

it("runs product approvals, provider disable/reload and private plugin access through a real MCP process", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-mcp-product-"));
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const tools = await ctx.plugin(ToolRuntime, {});
  let injected!: Context;
  const injection = await ctx.inject(["tools"], scope => { injected = scope; });
  const agentKey = {};
  const agent = createScope(injected, agentKey);
  const manager = new DshMcpManager(ctx, root);
  const managerScope = await ctx.plugin((scope: Context) => { scope.provide("amibaMcpManager", manager); });
  const service = { id: "documents", name: "Documents", version: "1", shareable: true };
  const connection = { id: "work", name: "Work", serviceId: "documents", identity: "account-one",
    configuration: { ownerId: "fixture", recordId: "work" },
    server: { transport: "stdio" as const, command: process.execPath,
      args: [fileURLToPath(new URL("./test/fixtures/documents-mcp.mjs", import.meta.url))],
      env: { FIXTURE_ACCOUNT: "account-one", FIXTURE_CREDENTIAL: "before" }, enabled: true } };
  const mountProvider = () => provideMcpConnection(ctx, { id: "provider", name: "Documents" }, service, connection,
    [{ name: "read", title: "Read documents" }, { name: "write", title: "Write documents" }]);
  let provider = mountProvider();
  const consumer = useMcpRequirement(ctx, { id: "wiki", name: "Wiki" }, {
    id: "read", name: "Read documents", serviceId: "documents", version: "1", sharing: "shared",
    tools: [{ name: "read", title: "Read documents" }],
  }, (feature, lease) => { feature.effect(() => lease.expose(agent.ctx)); });
  const approve = async (audience: string) => {
    const row = (await manager.access.list()).find(item => item.audience === audience)!;
    await manager.access.approve(row.id, "work", row.connections[0]!.approvalToken);
    await vi.waitFor(async () => expect((await manager.access.list()).find(item => item.id === row.id)?.state).toBe("ready"));
    return row.id;
  };
  const read = async () => {
    const name = ctx.tools.schemas(agentKey).find(item => item.name.endsWith("__read"))!.name;
    const result = await ctx.tools.execute({ name, agent: agentKey as never, arguments: {}, callId: "product" as never, signal: new AbortController().signal });
    expect(result.isError).toBe(false);
    return JSON.parse((result.content[0] as { text: string }).text) as { pid: number; credential: string };
  };
  try {
    await vi.waitFor(async () => expect(await manager.access.list()).toHaveLength(2));
    expect(ctx.tools.schemas(agentKey)).toEqual([]);
    expect((await manager.dependencies.list())[0]?.instances).toBe(0);
    await approve("plugin");
    const before = await read();
    expect(ctx.tools.schemas()).toEqual([]);
    const ordinaryId = await approve("ordinary-agents");
    expect(ctx.tools.schemas()).toHaveLength(2);
    expect(ctx.tools.schemas(agentKey)).toHaveLength(1);
    expect((await read()).pid).toBe(before.pid);
    await manager.access.revoke(ordinaryId);
    expect(ctx.tools.schemas()).toEqual([]);
    expect((await read()).pid).toBe(before.pid);
    await provider.dispose();
    await vi.waitFor(() => expect(ctx.tools.schemas(agentKey)).toEqual([]));
    expect(await manager.dependencies.list()).toEqual([]);
    connection.server.env.FIXTURE_CREDENTIAL = "after";
    provider = mountProvider();
    await vi.waitFor(() => expect(ctx.tools.schemas(agentKey)).toHaveLength(1));
    const after = await read();
    expect(after.credential).toBe("after");
    expect(after.pid).not.toBe(before.pid);
    expect(ctx.tools.schemas()).toEqual([]);
    await manager.access.forgetConfiguration("fixture", "work");
    await vi.waitFor(() => expect(ctx.tools.schemas(agentKey)).toEqual([]));
    expect((await manager.dependencies.list())[0]?.instances).toBe(0);
  } finally {
    await consumer.dispose(); await provider.dispose(); await manager.dispose(); await managerScope.dispose();
    agent.dispose(); await injection.dispose(); await tools.dispose(); await prompt.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

it("runs two consumer plugins through the official client and a real MCP process", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-mcp-runtime-"));
  const ctx = new Context();
  type Definition = { name: string; execute(args: unknown, exec: { signal: AbortSignal }): Promise<{ content: Array<{ text: string }> }> };
  const registered = new Map<string, Definition>();
  ctx.provide("tools", {
    register(definition: Definition) {
      registered.set(definition.name, definition);
      return () => { registered.delete(definition.name); };
    },
  } as never);
  const manager = new DshMcpManager(ctx, root);
  const dependencies = manager.dependencies;
  const owner = { id: "fixture-provider", name: "Fixture" };
  const service = { id: "documents", name: "Documents", version: "1", shareable: true };
  const connection = {
    id: "work", name: "Work", serviceId: service.id, identity: "work-account",
    server: { transport: "stdio" as const, command: process.execPath,
      args: [fileURLToPath(new URL("./test/fixtures/documents-mcp.mjs", import.meta.url))],
      env: { FIXTURE_ACCOUNT: "work-account", FIXTURE_CREDENTIAL: "before" }, enabled: true },
  };
  const request = { owner: { id: "wiki", name: "Wiki" }, serviceId: service.id,
    version: service.version, connectionId: connection.id, sharing: "shared" as const, tools: ["read"] };
  const wiki = dependencies.bind(request);
  const search = dependencies.bind({ ...request, owner: { id: "search", name: "Search" } });
  const read = async (serverName: string) => {
    const definition = registered.get(`mcp__${serverName}__read`)!;
    const result = await definition.execute({}, { signal: new AbortController().signal });
    return JSON.parse(result.content[0]!.text) as { account: string; credential: string; pid: number };
  };
  try {
    await dependencies.registerService(owner, service);
    const remove = await dependencies.registerConnection(owner, connection);
    const [a, b] = await Promise.all([wiki.waitForReady(), search.waitForReady()]);
    expect(a.serverName).toBe(b.serverName);
    expect(registered.size).toBe(0);
    b.expose(ctx);
    expect(registered.size).toBe(1);
    const before = await read(a.serverName);
    expect(before).toMatchObject({ account: "work-account", credential: "before" });
    await dependencies.renameConnection(owner.id, connection.id, "Renamed work");
    expect((await dependencies.list())[0]?.name).toBe("Renamed work");
    expect((await read(b.serverName)).pid).toBe(before.pid);
    expect(b.signal.aborted).toBe(false);
    await expect(dependencies.acquire({ ...request, tools: ["unknown_tool"] })).rejects.toThrow("tools_unavailable");
    expect((await read(b.serverName)).pid).toBe(before.pid);
    await wiki.dispose();
    expect((await read(b.serverName)).pid).toBe(before.pid);
    expect(b.signal.aborted).toBe(false);

    await dependencies.updateConnection(owner.id, { ...connection,
      server: { ...connection.server, env: { ...connection.server.env, FIXTURE_CREDENTIAL: "after" } },
    });
    expect(b.signal.aborted).toBe(true);
    const renewed = await search.waitForReady();
    renewed.expose(ctx);
    const after = await read(renewed.serverName);
    expect(after.credential).toBe("after");
    expect(after.pid).not.toBe(before.pid);

    await remove();
    expect(registered.size).toBe(0);
    await dependencies.registerConnection(owner, connection);
    const recovered = await search.waitForReady();
    recovered.expose(ctx);
    expect((await read(recovered.serverName)).account).toBe("work-account");
    await search.dispose();
    expect(registered.size).toBe(0);
  } finally {
    await wiki.dispose();
    await search.dispose();
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

it("keeps two real MCP consumer grants separate from ordinary-agent exposure", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-mcp-scopes-"));
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const tools = await ctx.plugin(ToolRuntime, {});
  let injected!: Context;
  const injection = await ctx.inject(["tools"], scope => { injected = scope; });
  const readerKey = {}, writerKey = {}, ordinaryKey = {};
  const reader = createScope(injected, readerKey), writer = createScope(injected, writerKey);
  const ordinary = createScope(injected, ordinaryKey);
  const manager = new DshMcpManager(ctx, root);
  const deps = manager.dependencies;
  const owner = { id: "provider", name: "Documents" };
  const service = { id: "documents", name: "Documents", version: "1", shareable: true };
  const request = { owner: { id: "reader", name: "Reader" }, serviceId: service.id, version: "1",
    connectionId: "work", sharing: "shared" as const, tools: ["read"] };
  const call = (name: string, agent: object) => ctx.tools.execute({
    name, agent: agent as never, arguments: {}, callId: "fixture" as never,
    signal: new AbortController().signal,
  });
  try {
    await deps.registerService(owner, service);
    await deps.registerConnection(owner, { id: "work", name: "Work", serviceId: service.id, identity: "account-one",
      server: { transport: "stdio", command: process.execPath,
        args: [fileURLToPath(new URL("./test/fixtures/documents-mcp.mjs", import.meta.url))],
        env: { FIXTURE_ACCOUNT: "account-one" }, enabled: true } });
    const readLease = await deps.acquire(request);
    const writeLease = await deps.acquire({ ...request, owner: { id: "writer", name: "Writer" }, tools: ["write"] });
    expect(readLease.serverName).toBe(writeLease.serverName);
    readLease.expose(reader.ctx);
    writeLease.expose(writer.ctx);
    const readName = `mcp__${readLease.serverName}__read`, writeName = `mcp__${readLease.serverName}__write`;
    expect(ctx.tools.schemas()).toEqual([]);
    expect((await call(readName, readerKey)).isError).toBe(false);
    expect((await call(writeName, readerKey)).isError).toBe(true);
    expect((await call(writeName, writerKey)).isError).toBe(false);
    expect((await call(readName, ordinaryKey)).isError).toBe(true);

    const publicLease = await deps.acquire({ ...request, owner: { id: "ordinary-agents", name: "Ordinary agents" }, tools: ["read", "write"] });
    publicLease.expose(injected);
    expect((await call(readName, ordinaryKey)).isError).toBe(false);
    expect((await call(writeName, readerKey)).isError).toBe(true);
    expect(ctx.tools.schemas(readerKey).map(tool => tool.name)).toEqual([readName]);
    await publicLease.release();
    expect((await call(readName, ordinaryKey)).isError).toBe(true);
    expect((await call(writeName, writerKey)).isError).toBe(false);
    expect((await deps.list())[0]?.instances).toBe(1);
    await readLease.release();
    expect((await call(writeName, writerKey)).isError).toBe(false);
    await writeLease.release();
    expect(ctx.tools.schemas(writerKey)).toEqual([]);
  } finally {
    await manager.dispose();
    reader.dispose(); writer.dispose(); ordinary.dispose();
    await injection.dispose(); await tools.dispose(); await prompt.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
