import { describe, expect, it, vi } from "vitest";
import type { ManagedMcpServer } from "./manager.js";
import { McpDependencies } from "./dependencies.js";
const owner = { id: "lark", name: "Feishu" };
const service = {
  id: "lark.mcp",
  name: "Feishu MCP",
  version: "0.5.1",
  shareable: true,
};
const server = {
  serverName: "ignored",
  transport: "stdio" as const,
  command: "node",
  args: [],
  env: { TOKEN: "secret" },
  enabled: true,
};
const connection = {
  id: "work",
  name: "Work",
  serviceId: service.id,
  identity: "tenant-one",
  server,
};
const request = {
  owner: { id: "docs", name: "Documents" },
  serviceId: service.id,
  version: service.version,
  connectionId: "work",
  sharing: "shared" as const,
};
async function setup(shareable = true) {
  const stops: ReturnType<typeof vi.fn>[] = [];
  const mount = vi.fn(async (_server: ManagedMcpServer) => {
    const stop = vi.fn(async () => {});
    stops.push(stop);
    return stop;
  });
  const registry = new McpDependencies(mount);
  const removeService = await registry.registerService(owner, {
    ...service,
    shareable,
  });
  const removeConnection = await registry.registerConnection(owner, connection);
  return { registry, mount, stops, removeService, removeConnection };
}
describe("MCP dependency leases", () => {
  it("starts on demand, shares explicitly, and waits for the last release", async () => {
    const { registry, mount, stops } = await setup();
    expect(mount).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([
      registry.acquire(request),
      registry.acquire({ ...request, owner: { id: "wiki", name: "Wiki" } }),
    ]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(a.serverName).toBe(b.serverName);
    expect((await registry.list())[0]?.consumers).toEqual([
      "Documents",
      "Wiki",
    ]);
    await a.release();
    await a.release();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(stops[0]).not.toHaveBeenCalled();
    await b.release();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await registry.list())).not.toContain("secret");
  });
  it("isolates by default, and never pools different connections", async () => {
    const { registry, mount } = await setup();
    await registry.acquire({ ...request, sharing: undefined });
    await registry.acquire({ ...request, sharing: undefined });
    await registry.registerConnection(owner, {
      ...connection,
      id: "personal",
      identity: "tenant-two",
    });
    await registry.acquire(request);
    await registry.acquire({ ...request, connectionId: "personal" });
    expect(mount).toHaveBeenCalledTimes(4);
    await registry.dispose();
  });
  it("rejects incompatible versions, undeclared sharing and mismatched owners", async () => {
    const { registry, mount } = await setup(false);
    await expect(registry.acquire(request)).rejects.toThrow(
      "mcp_sharing_not_supported",
    );
    await expect(
      registry.acquire({ ...request, version: "2" }),
    ).rejects.toThrow("version_mismatch");
    await expect(
      registry.updateConnection("other", connection),
    ).rejects.toThrow("owner_mismatch");
    await expect(
      registry.registerConnection(
        { id: "other", name: "Other" },
        { ...connection, id: "new" },
      ),
    ).rejects.toThrow("owner_mismatch");
    expect(mount).not.toHaveBeenCalled();
  });
  it("revokes old leases before credential replacement; requires a fresh acquisition", async () => {
    const { registry, mount, stops } = await setup();
    const old = await registry.acquire(request);
    await registry.updateConnection(owner.id, {
      ...connection,
      server: { ...server, env: { TOKEN: "rotated" } },
    });
    expect(old.signal.aborted).toBe(true);
    expect(stops[0]).toHaveBeenCalledOnce();
    const next = await registry.acquire(request);
    expect(next.signal.aborted).toBe(false);
    expect(mount.mock.calls.at(-1)?.[0]).toMatchObject({
      env: { TOKEN: "rotated" },
    });
    await old.release();
    expect(next.signal.aborted).toBe(false);
    await registry.dispose();
  });
  it("removes provider instances and allows clean registration after reactivation", async () => {
    const { registry, removeService, stops } = await setup();
    const lease = await registry.acquire(request);
    await removeService();
    expect(lease.signal.aborted).toBe(true);
    expect(stops[0]).toHaveBeenCalledOnce();
    await expect(registry.acquire(request)).rejects.toThrow("unavailable");
    await registry.registerService(owner, service);
    await registry.registerConnection(owner, connection);
    await registry.acquire(request);
    await registry.dispose();
    await expect(registry.acquire(request)).rejects.toThrow("disposed");
  });
  it("does not retain a failed startup and can retry", async () => {
    const { registry, mount } = await setup();
    mount.mockRejectedValueOnce(new Error("credential secret rejected"));
    await expect(registry.acquire(request)).rejects.toThrow(
      "mcp_dependency_start_failed",
    );
    expect((await registry.list())[0]).toMatchObject({
      state: "error",
      instances: 0,
      consumers: [],
    });
    await registry.acquire(request);
    expect((await registry.list())[0]?.state).toBe("in-use");
    await registry.dispose();
  });
  it("retries failed final release instead of orphaning the instance", async () => {
    const { registry, stops } = await setup();
    const lease = await registry.acquire(request);
    stops[0]!.mockRejectedValueOnce(new Error("busy"));
    await expect(lease.release()).rejects.toThrow("busy");
    await lease.release();
    expect((await registry.list())[0]?.instances).toBe(0);
  });
});

it("handles duplicate concurrent release without withdrawing another provider registration", async () => {
  const { registry, removeService } = await setup();
  const second = await registry.registerService(owner, service);
  await Promise.all([removeService(), removeService()]);
  const lease = await registry.acquire(request);
  expect(lease.signal.aborted).toBe(false);
  await second();
  expect(lease.signal.aborted).toBe(true);
});

it("blocks acquisition while a failed connection revocation is pending", async () => {
  const { registry, stops, removeConnection } = await setup();
  const lease = await registry.acquire(request);
  stops[0]!.mockRejectedValueOnce(new Error("busy"));
  await expect(removeConnection()).rejects.toThrow("busy");
  expect(lease.signal.aborted).toBe(true);
  await expect(registry.acquire(request)).rejects.toThrow("stopping");
  await removeConnection();
  expect(await registry.list()).toEqual([]);
});

it("aborts every isolated consumer even when the first shutdown fails", async () => {
  const { registry, stops, removeConnection } = await setup();
  const a = await registry.acquire({ ...request, sharing: "isolated" });
  const b = await registry.acquire({ ...request, sharing: "isolated" });
  stops[0]!.mockRejectedValueOnce(new Error("busy"));
  await expect(removeConnection()).rejects.toThrow("busy");
  expect(a.signal.aborted).toBe(true);
  expect(b.signal.aborted).toBe(true);
  expect(stops[1]).toHaveBeenCalledOnce();
  await removeConnection();
});
