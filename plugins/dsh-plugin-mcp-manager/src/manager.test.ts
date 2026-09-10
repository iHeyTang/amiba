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
    const dispose = await manager.registerManagedServer({
      ...stdioServer("conn-lark"),
      displayName: "Work account",
    });
    await manager.list();
    expect(reload.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverName: "conn-lark",
          displayName: "Work account",
        }),
      ]),
    );
    // Programmatic servers never enter the persisted view.
    expect((await manager.list()).servers).toHaveLength(0);

    dispose();
    await manager.list();
    expect(
      (reload.mock.lastCall?.[0] as ManagedMcpServer[]).map(
        (s) => s.serverName,
      ),
    ).not.toContain("conn-lark");
    dispose(); // idempotent — no throw
  });

  it("keeps programmatic servers present across user save/remove reloads", async () => {
    const { manager, reload } = await makeManager();
    await manager.registerManagedServer(stdioServer("conn-lark"));
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
    const dispose = await manager.registerManagedServer(
      stdioServer("conn-lark"),
    );
    // Programmatic-vs-programmatic duplicate (synchronous throw converted to rejected promise)
    await expect(
      manager.registerManagedServer(stdioServer("conn-lark")),
    ).rejects.toThrow("duplicate managed MCP server");
    // Save-vs-programmatic name conflict
    await expect(
      manager.save({
        serverName: "conn-lark",
        transport: "stdio",
        enabled: true,
        command: "echo",
        args: [],
      }),
    ).rejects.toThrow("name_reserved");
    // Stored-name collision with new registration
    await manager.save({
      serverName: "user-two",
      transport: "stdio",
      enabled: true,
      command: "echo",
      args: [],
    });
    await expect(
      manager.registerManagedServer(stdioServer("user-two")),
    ).rejects.toThrow("duplicate managed MCP server");
    // Queue is not poisoned; another registration succeeds
    const dispose2 = await manager.registerManagedServer(
      stdioServer("conn-unrelated"),
    );
    expect(dispose2).toBeDefined();
    dispose(); // cleanup from first registration
    dispose2(); // cleanup from successful registration
  });
});

it("does not poison initial startup with a failing managed dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-mcp-start-"));
  roots.push(root);
  const reload = vi.fn(async (servers: ManagedMcpServer[]) => {
    if (servers.some((server) => server.serverName === "bad"))
      throw new Error("start failed");
    return {
      generation: 1,
      configured: servers.map((server) => server.serverName),
    };
  });
  const manager = new DshMcpManager({} as never, root, undefined, {
    reload,
    dispose: vi.fn(async () => {}),
  });
  await expect(
    manager.registerManagedServer(stdioServer("bad")),
  ).rejects.toThrow("start failed");
  const release = await manager.registerManagedServer(stdioServer("good"));
  await release();
  await manager.dispose();
  await expect(
    manager.registerManagedServer(stdioServer("late")),
  ).rejects.toThrow("disposed");
});

it("runs the complete dependency-to-supervisor path without persisting plugin credentials", async () => {
  const { manager, reload } = await makeManager();
  const owner = { id: "provider", name: "Provider" };
  await manager.dependencies.registerService(owner, {
    id: "docs",
    name: "Documents",
    version: "1",
    shareable: true,
  });
  await manager.dependencies.registerConnection(owner, {
    id: "work",
    name: "Work",
    serviceId: "docs",
    identity: "tenant",
    server: stdioServer("ignored"),
  });
  const demand = {
    owner: { id: "one", name: "One" },
    serviceId: "docs",
    version: "1",
    connectionId: "work",
    sharing: "shared" as const,
  };
  const [a, b] = await Promise.all([
    manager.dependencies.acquire(demand),
    manager.dependencies.acquire({
      ...demand,
      owner: { id: "two", name: "Two" },
    }),
  ]);
  expect(a.serverName).toBe(b.serverName);
  expect(reload.mock.lastCall?.[0] as ManagedMcpServer[]).toHaveLength(1);
  const snapshot = await manager.list();
  expect(snapshot.servers).toEqual([]);
  expect(snapshot.dependencies[0]).toMatchObject({
    consumers: ["One", "Two"],
    instances: 1,
  });
  await a.release();
  expect((await manager.list()).dependencies[0]?.consumers).toEqual(["Two"]);
  await b.release();
  expect(reload.mock.lastCall?.[0]).toEqual([]);
  await manager.dispose();
});
