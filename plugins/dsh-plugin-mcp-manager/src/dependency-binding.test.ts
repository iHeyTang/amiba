import { describe, expect, it, vi } from "vitest";
import { McpDependencies } from "./dependencies.js";

const provider = { id: "provider", name: "Documents" };
const service = { id: "documents", name: "Documents", version: "1", shareable: true };
const connection = {
  id: "work", name: "Work", serviceId: service.id, identity: "account-one",
  server: { transport: "stdio" as const, command: "node", args: [], env: {}, enabled: true },
};
const request = {
  owner: { id: "wiki", name: "Wiki" }, serviceId: service.id, version: "1",
  connectionId: connection.id, sharing: "shared" as const,
};

function setup() {
  const stops: ReturnType<typeof vi.fn>[] = [];
  const mount = vi.fn(async () => {
    const stop = vi.fn(async () => {});
    stops.push(stop);
    return stop;
  });
  return { dependencies: new McpDependencies(mount), mount, stops };
}

describe("managed MCP dependency bindings", () => {
  it("waits for a late provider and recovers after provider reload", async () => {
    const { dependencies, mount } = setup();
    const binding = dependencies.bind(request);
    await binding.retry();
    expect(binding.getState().state).toBe("waiting");
    const removeService = await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    const first = await binding.waitForReady();
    await removeService();
    expect(first.signal.aborted).toBe(true);
    await binding.retry();
    expect(binding.getState().state).toBe("waiting");
    await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    const next = await binding.waitForReady();
    expect(next).not.toBe(first);
    expect(mount).toHaveBeenCalledTimes(2);
    await binding.dispose();
    await dependencies.dispose();
  });

  it("renews both consumers on same-account credential rotation, preserves the other on consumer stop", async () => {
    const { dependencies, mount, stops } = setup();
    await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    const a = dependencies.bind(request);
    const b = dependencies.bind({ ...request, owner: { id: "search", name: "Search" } });
    const [oldA, oldB] = await Promise.all([a.waitForReady(), b.waitForReady()]);
    expect(mount).toHaveBeenCalledTimes(1);
    await dependencies.updateConnection(provider.id, {
      ...connection, server: { ...connection.server, env: { TOKEN: "rotated" } },
    });
    expect(oldA.signal.aborted && oldB.signal.aborted).toBe(true);
    const [nextA, nextB] = await Promise.all([a.waitForReady(), b.waitForReady()]);
    expect(nextA.serverName).toBe(nextB.serverName);
    expect(mount).toHaveBeenCalledTimes(2);
    await a.dispose();
    expect(nextB.signal.aborted).toBe(false);
    expect(stops[1]).not.toHaveBeenCalled();
    await b.dispose();
    expect(stops[1]).toHaveBeenCalledOnce();
    await dependencies.dispose();
  });

  it("does not transfer authorization when a connection changes account", async () => {
    const { dependencies, mount } = setup();
    await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    const binding = dependencies.bind(request);
    await binding.waitForReady();
    await dependencies.updateConnection(provider.id, { ...connection, identity: "account-two" });
    await expect(binding.waitForReady()).rejects.toThrow("identity_mismatch");
    expect(mount).toHaveBeenCalledTimes(1);
    await binding.dispose();
    await dependencies.dispose();
  });

  it("reports startup failure without spinning and supports explicit retry", async () => {
    const { dependencies, mount } = setup();
    await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    mount.mockRejectedValueOnce(new Error("private credential"));
    const binding = dependencies.bind(request);
    await expect(binding.waitForReady()).rejects.toThrow("mcp_dependency_start_failed");
    expect(mount).toHaveBeenCalledOnce();
    await binding.retry();
    expect(binding.getState().state).toBe("ready");
    await binding.dispose();
    await dependencies.dispose();
  });

  it("releases an acquisition that completes after its consumer scope closes", async () => {
    let resolve!: (release: () => Promise<void>) => void;
    const mount = vi.fn(() => new Promise<() => Promise<void>>(done => { resolve = done; }));
    const dependencies = new McpDependencies(mount);
    await dependencies.registerService(provider, service);
    await dependencies.registerConnection(provider, connection);
    const scope = new AbortController();
    const binding = dependencies.bind(request, scope.signal);
    const ready = binding.waitForReady();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    scope.abort();
    await expect(ready).rejects.toThrow("disposed");
    const stop = vi.fn(async () => {});
    resolve(stop);
    await binding.dispose();
    expect(stop).toHaveBeenCalledOnce();
    expect((await dependencies.list())[0]?.instances).toBe(0);
    await dependencies.dispose();
  });

  it("settles waiting consumers on manager disposal and cancellation", async () => {
    const { dependencies } = setup();
    const binding = dependencies.bind(request);
    const scope = new AbortController();
    const wait = binding.waitForReady(scope.signal);
    scope.abort();
    await expect(wait).rejects.toThrow("wait_cancelled");
    const ready = binding.waitForReady();
    const rejection = expect(ready).rejects.toThrow("disposed");
    await dependencies.dispose();
    await rejection;
    await binding.dispose();
  });
});
