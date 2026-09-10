// @vitest-environment node
import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";
import { McpDependencies } from "./dependencies.js";
import { useMcpDependency, useMcpRequirement } from "./plugin-dependency.js";
import { McpAccess } from "./access.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("binds feature resources to plugin and Manager lifetimes regardless of loading order", async () => {
  const ctx = new Context();
  ctx.provide("tools", {} as never);
  const owner = { id: "provider", name: "Provider" };
  const service = { id: "documents", name: "Documents", version: "1", shareable: true };
  const connection = { id: "work", name: "Work", serviceId: service.id, identity: "one",
    server: { transport: "stdio" as const, command: "node", args: [], env: {}, enabled: true } };
  const request = { owner: { id: "wiki", name: "Wiki" }, serviceId: service.id, version: "1", connectionId: "work", sharing: "shared" as const };
  const events: string[] = [];
  const startConsumer = async (id: string) => ctx.plugin(async (consumerCtx: Context) => {
    useMcpDependency(consumerCtx, { ...request, owner: { id, name: id } }, (featureCtx, lease) => {
      expect(lease.signal.aborted).toBe(false);
      events.push(`start:${id}`);
      featureCtx.effect(() => () => { events.push(`stop:${id}`); });
    });
  });
  const wiki = await startConsumer("wiki");
  const search = await startConsumer("search");
  const startManager = async () => {
    const dependencies = new McpDependencies(async () => async () => {});
    const fiber = await ctx.plugin(async (managerCtx: Context) => {
      managerCtx.provide("amibaMcpManager", { dependencies } as never);
      managerCtx.effect(() => () => dependencies.dispose());
      await dependencies.registerService(owner, service);
      await dependencies.registerConnection(owner, connection);
    });
    return { dependencies, fiber };
  };
  let manager = await startManager();
  try {
    await vi.waitFor(() => expect(events.filter(e => e.startsWith("start:"))).toHaveLength(2));
    await wiki.dispose();
    expect(events).toContain("stop:wiki");
    expect(events).not.toContain("stop:search");
    expect((await manager.dependencies.list())[0]?.consumers).toEqual(["search"]);
    await manager.fiber.dispose();
    await vi.waitFor(() => expect(events).toContain("stop:search"));
    manager = await startManager();
    await vi.waitFor(() => expect(events.filter(e => e === "start:search")).toHaveLength(2));
    await search.dispose();
    expect(events.filter(e => e === "stop:search")).toHaveLength(2);
    expect((await manager.dependencies.list())[0]?.instances).toBe(0);
  } finally {
    await wiki.dispose();
    await search.dispose();
    await manager.fiber.dispose();
  }
});

it("reports partial feature activation failure, cleans it up, retries explicitly and revokes without leaking resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-plugin-access-"));
  const ctx = new Context();
  ctx.provide("tools", {} as never);
  const deps = new McpDependencies(async () => async () => {});
  const access = new McpAccess(deps, root);
  ctx.provide("amibaMcpManager", { dependencies: deps, access } as never);
  const provider = { id: "documents", name: "Documents" };
  await deps.registerService(provider, { id: "documents", name: "Documents", version: "1" });
  await deps.registerConnection(provider, { id: "work", name: "Work", serviceId: "documents", identity: "one",
    server: { transport: "stdio", command: "node", args: [], env: {}, enabled: true } });
  const activate = vi.fn().mockImplementationOnce(() => { throw new Error("private failure details"); });
  const cleanup = vi.fn();
  const plugin = await ctx.plugin(async (pluginCtx: Context) => {
    useMcpRequirement(pluginCtx, { id: "wiki", name: "Wiki" }, {
      id: "read", name: "Read documents", serviceId: "documents", version: "1",
      tools: [{ name: "read", title: "Read documents" }],
    }, featureCtx => { featureCtx.effect(() => cleanup); activate(); });
  });
  try {
    await vi.waitFor(async () => expect(await access.list()).toHaveLength(1));
    expect(activate).not.toHaveBeenCalled();
    const view = (await access.list())[0]!;
    await access.approve(view.id, "work", view.connections[0]!.approvalToken);
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect((await access.list())[0]).toMatchObject({ state: "error", code: "mcp_feature_activation_failed" }));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(JSON.stringify(await access.list())).not.toContain("private failure details");
    await access.retry(view.id);
    await vi.waitFor(async () => expect((await access.list())[0]?.state).toBe("ready"));
    expect(activate).toHaveBeenCalledTimes(2);
    await access.revoke(view.id);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
    await plugin.dispose();
    expect(await access.list()).toEqual([]);
    expect((await deps.list())[0]?.instances).toBe(0);
  } finally {
    await plugin.dispose(); await access.dispose(); await deps.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
