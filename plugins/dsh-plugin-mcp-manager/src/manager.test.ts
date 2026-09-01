import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DshMcpManager, type ManagedMcpServer } from "./manager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function stdioServer(serverName: string): ManagedMcpServer {
  return {
    serverName,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@larksuiteoapi/lark-mcp", "mcp"],
    env: { APP_ID: "cli_x" },
    enabled: true,
  };
}

async function makeManager() {
  const root = await mkdtemp(join(tmpdir(), "amiba-mcp-manager-"));
  roots.push(root);
  const reload = vi.fn(async (servers: unknown[]) => ({
    generation: reload.mock.calls.length,
    configured: (servers as ManagedMcpServer[]).map((s) => s.serverName),
  }));
  const supervisor = { reload, dispose: vi.fn(async () => undefined) };
  const ctx = { logger: () => ({ error: vi.fn() }) };
  const manager = new DshMcpManager(ctx as never, root, undefined, supervisor);
  return { manager, reload };
}

describe("programmatic managed servers", () => {
  it("registers, merges into supervisor reloads, and unwinds via the disposer", async () => {
    const { manager, reload } = await makeManager();
    const dispose = manager.registerManagedServer(stdioServer("conn-lark"));
    await manager.list();
    expect(reload.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ serverName: "conn-lark" })]),
    );
    // Programmatic servers never enter the persisted view.
    expect((await manager.list()).servers).toHaveLength(0);

    dispose();
    await manager.list();
    expect(
      (reload.mock.lastCall?.[0] as ManagedMcpServer[]).map((s) => s.serverName),
    ).not.toContain("conn-lark");
    dispose(); // idempotent — no throw
  });

  it("keeps programmatic servers present across user save/remove reloads", async () => {
    const { manager, reload } = await makeManager();
    manager.registerManagedServer(stdioServer("conn-lark"));
    await manager.save({
      serverName: "user-one",
      transport: "stdio",
      enabled: true,
      command: "echo",
      args: [],
    });
    const names = (reload.mock.lastCall?.[0] as ManagedMcpServer[]).map(
      (s) => s.serverName,
    );
    expect(names).toEqual(expect.arrayContaining(["user-one", "conn-lark"]));
  });

  it("rejects duplicate names in both directions", async () => {
    const { manager } = await makeManager();
    manager.registerManagedServer(stdioServer("conn-lark"));
    expect(() => manager.registerManagedServer(stdioServer("conn-lark"))).toThrow();
    await expect(
      manager.save({
        serverName: "conn-lark",
        transport: "stdio",
        enabled: true,
        command: "echo",
        args: [],
      }),
    ).rejects.toThrow("name_reserved");
  });
});
