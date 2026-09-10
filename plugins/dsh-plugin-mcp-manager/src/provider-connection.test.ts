// @vitest-environment node
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { provideMcpConnection } from "./provider-connection.js";
import { McpAccess } from "./access.js";
import { McpDependencies } from "./dependencies.js";

it("registers a late-loaded provider without granting tools and reconstructs approved usage after Manager reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-provider-"));
  const ctx = new Context();
  ctx.provide("tools", {} as never);
  const mount = vi.fn(async () => async () => {});
  const expose = vi.fn((_server: string, _ctx: Context, _tools: readonly string[], _signal: AbortSignal) => () => {});
  const owner = { id: "documents", name: "Documents" };
  const provider = await ctx.plugin(async (scope: Context) => {
    provideMcpConnection(scope, owner, { id: "documents", name: "Documents", version: "1", shareable: true }, {
      id: "work", name: "Work", identity: "account-one", serviceId: "documents",
      server: { transport: "stdio", command: "node", args: [], env: {}, enabled: true },
    }, [{ name: "read", title: "Read documents" }]);
  });
  const startManager = async () => {
    const deps = new McpDependencies(mount, expose);
    const access = new McpAccess(deps, root);
    const fiber = await ctx.plugin(async (scope: Context) => {
      scope.provide("amibaMcpManager", { dependencies: deps, access } as never);
      scope.effect(() => async () => { try { await access.dispose(); } finally { await deps.dispose(); } });
    });
    return { deps, access, fiber };
  };
  let manager = await startManager();
  try {
    await vi.waitFor(async () => expect(await manager.access.list()).toHaveLength(1));
    expect(mount).not.toHaveBeenCalled();
    const view = (await manager.access.list())[0]!;
    expect(view.audience).toBe("ordinary-agents");
    await manager.access.approve(view.id, "work", view.connections[0]!.approvalToken);
    await vi.waitFor(() => expect(expose).toHaveBeenCalledOnce());
    expect(expose.mock.calls[0]?.[2]).toEqual(["read"]);
    await manager.fiber.dispose();
    manager = await startManager();
    await vi.waitFor(() => expect(expose).toHaveBeenCalledTimes(2));
    expect(mount).toHaveBeenCalledTimes(2);
    await provider.dispose();
    expect(await manager.access.list()).toMatchObject([{ state: "inactive", connectionName: "Work" }]);
    expect(await manager.deps.list()).toEqual([]);
    await manager.access.revoke(view.id);
    expect(await manager.access.list()).toEqual([]);
  } finally {
    await provider.dispose(); await manager.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
