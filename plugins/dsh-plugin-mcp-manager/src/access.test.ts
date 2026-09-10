// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { McpAccess } from "./access.js";
import { McpDependencies } from "./dependencies.js";
import { Context } from "@deepseek-ai/cordis";

const owner = { id: "wiki", name: "Wiki" };
const provider = { id: "documents", name: "Documents" };
const service = { id: "documents", name: "Documents", version: "1", shareable: true };
const requirement = { id: "search", name: "Search documents", serviceId: "documents", version: "1",
  tools: [{ name: "read", title: "Read documents" }], sharing: "shared" as const };
const connection = { id: "work", name: "Work", serviceId: "documents", identity: "account-one",
  server: { transport: "stdio" as const, command: "node", args: [], env: { TOKEN: "private-credential" }, enabled: true } };

async function approve(access: McpAccess, id: string, connectionId: string) {
  const row = (await access.list()).find(item => item.id === id)!;
  const token = row.connections.find(item => item.id === connectionId)!.approvalToken;
  await access.approve(id, connectionId, token);
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "mcp-access-"));
  const mount = vi.fn(async () => async () => {});
  const deps = new McpDependencies(mount);
  const access = new McpAccess(deps, root);
  const remove = await deps.registerService(provider, service);
  await deps.registerConnection(provider, connection);
  return { root, mount, deps, access, remove, async cleanup() {
    await access.dispose(); await deps.dispose(); await rm(root, { recursive: true, force: true });
  } };
}

it("persists explicit approval, restores it, and requires approval for expanded capabilities", async () => {
  const s = await setup();
  let access = s.access;
  try {
    const consumer = await access.register(owner, requirement);
    expect((await access.list())[0]?.state).toBe("approval-required");
    expect(s.mount).not.toHaveBeenCalled();
    await approve(access, consumer.id, "work");
    await vi.waitFor(() => expect(consumer.binding.getState().state).toBe("ready"));
    const ready = consumer.binding.getState();
    if (ready.state !== "ready") throw new Error("Expected approved lease");
    expect(() => ready.lease.expose(new Context())).toThrow("mcp_plugin_scope_required");
    const persisted = await readFile(join(s.root, "access.json"), "utf8");
    expect(persisted).not.toContain("private-credential");
    expect(persisted).not.toContain("env");
    await consumer.dispose(); await access.dispose();
    access = new McpAccess(s.deps, s.root);
    const restored = await access.register(owner, requirement);
    await vi.waitFor(() => expect(restored.binding.getState().state).toBe("ready"));
    await restored.dispose();
    const expanded = await access.register(owner, { ...requirement,
      tools: [...requirement.tools, { name: "write", title: "Write documents" }] });
    expect(expanded.binding.getState()).toEqual({ state: "error", code: "mcp_approval_required" });
    expect(s.mount).toHaveBeenCalledTimes(2);
    await approve(access, expanded.id, "work");
    await vi.waitFor(() => expect(expanded.binding.getState().state).toBe("ready"));
    await access.revoke(expanded.id);
    expect((await access.list())[0]?.state).toBe("approval-required");
    expect((await s.deps.list())[0]?.instances).toBe(0);
  } finally { await access.dispose(); await s.cleanup(); }
});

it("keeps consumer approvals separate and blocks an account change until reapproved", async () => {
  const s = await setup();
  try {
    const a = await s.access.register(owner, requirement);
    const b = await s.access.register({ id: "search", name: "Search" }, requirement);
    await approve(s.access, a.id, "work");
    await vi.waitFor(() => expect(a.binding.getState().state).toBe("ready"));
    expect(b.binding.getState().state).toBe("error");
    await approve(s.access, b.id, "work");
    await vi.waitFor(() => expect(b.binding.getState().state).toBe("ready"));
    expect((await s.deps.list())[0]?.instances).toBe(1);
    await s.access.revoke(a.id);
    expect(b.binding.getState().state).toBe("ready");
    await s.deps.updateConnection(provider.id, { ...connection, identity: "account-two" });
    await vi.waitFor(() => expect(b.binding.getState()).toEqual({ state: "error", code: "mcp_dependency_identity_mismatch" }));
    expect((await s.access.list()).find(item => item.id === b.id)?.state).toBe("approval-required");
    await approve(s.access, b.id, "work");
    await vi.waitFor(() => expect(b.binding.getState().state).toBe("ready"));
    expect(a.binding.getState().state).toBe("error");
  } finally { await s.cleanup(); }
});

it("retains approval across provider reload but never accepts an unapproved version", async () => {
  const s = await setup();
  try {
    const consumer = await s.access.register(owner, requirement);
    await approve(s.access, consumer.id, "work");
    await vi.waitFor(() => expect(consumer.binding.getState().state).toBe("ready"));
    await s.remove();
    await vi.waitFor(() => expect(consumer.binding.getState().state).toBe("waiting"));
    await s.deps.registerService(provider, { ...service, version: "2" });
    await s.deps.registerConnection(provider, connection);
    await vi.waitFor(() => expect(consumer.binding.getState()).toEqual({ state: "error", code: "mcp_dependency_version_mismatch" }));
    await expect(s.access.approve(consumer.id, "work", "old")).rejects.toThrow("unavailable");
    await consumer.dispose();
    const upgraded = await s.access.register(owner, { ...requirement, version: "2" });
    expect((await s.access.list())[0]?.state).toBe("approval-required");
    await approve(s.access, upgraded.id, "work");
    await vi.waitFor(() => expect(upgraded.binding.getState().state).toBe("ready"));
  } finally { await s.cleanup(); }
});

it("forgets a permanently removed owner without revoking another plugin on the same connection", async () => {
  const s = await setup();
  try {
    const a = await s.access.register(owner, requirement);
    const b = await s.access.register({ id: "other", name: "Other" }, requirement);
    await approve(s.access, a.id, "work");
    await approve(s.access, b.id, "work");
    await vi.waitFor(() => expect(b.binding.getState().state).toBe("ready"));
    await a.dispose();
    await s.access.forgetOwner(owner.id);
    expect((await s.access.list()).map(item => item.id)).toEqual([b.id]);
    expect(b.binding.getState().state).toBe("ready");
    const reinstalled = await s.access.register(owner, requirement);
    expect(reinstalled.binding.getState()).toEqual({ state: "error", code: "mcp_approval_required" });
    expect((await s.deps.list())[0]?.instances).toBe(1);
  } finally { await s.cleanup(); }
});

it("reads configuration inventory inside the approval queue instead of pruning against a stale snapshot", async () => {
  const s = await setup();
  try {
    await s.deps.registerConnection(provider, { ...connection, id: "owned", configuration: { ownerId: "connector-core", recordId: "new-record" } });
    const consumer = await s.access.register(owner, requirement);
    const view = (await s.access.list())[0]!;
    const options = await s.deps.connectionsFor("documents", "1");
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const lookup = vi.spyOn(s.deps, "connectionsFor").mockImplementationOnce(async () => { await blocked; return options; });
    const approving = s.access.approve(consumer.id, "owned", view.connections.find(item => item.id === "owned")!.approvalToken);
    let records: string[] = [];
    const inventory = vi.fn(async () => records);
    const pruning = s.access.retainConfigurations("connector-core", inventory);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(inventory).not.toHaveBeenCalled();
    records = ["new-record"];
    release();
    await approving; await pruning;
    expect((await s.access.list())[0]?.connectionId).toBe("owned");
    await s.access.retainConfigurations("connector-core", async () => []);
    expect((await s.access.list())[0]?.state).toBe("approval-required");
    lookup.mockRestore();
  } finally { await s.cleanup(); }
});

it("rejects approval from a stale page after the selected account changes", async () => {
  const s = await setup();
  try {
    const consumer = await s.access.register(owner, requirement);
    const reviewed = (await s.access.list())[0]!.connections[0]!.approvalToken;
    await s.deps.updateConnection(provider.id, { ...connection, identity: "account-two" });
    await expect(s.access.approve(consumer.id, "work", reviewed)).rejects.toThrow("review_stale");
    expect(s.mount).not.toHaveBeenCalled();
    await approve(s.access, consumer.id, "work");
    await vi.waitFor(() => expect(consumer.binding.getState().state).toBe("ready"));
  } finally { await s.cleanup(); }
});

it("keeps inactive approval visible and revocable, and removes only deleted configuration records", async () => {
  const s = await setup();
  try {
    await s.deps.registerConnection(provider, { ...connection, id: "owned",
      configuration: { ownerId: "connector-core", recordId: "record-a" } });
    const a = await s.access.register(owner, requirement);
    await approve(s.access, a.id, "owned");
    await vi.waitFor(() => expect(a.binding.getState().state).toBe("ready"));
    await a.dispose();
    const retained = (await s.access.list())[0]!;
    expect(retained).toMatchObject({ state: "inactive", plugin: "Wiki", connectionName: "Work",
      configuration: { ownerId: "connector-core", recordId: "record-a" } });
    await s.access.retainConfigurations("another-provider", []);
    expect(await s.access.list()).toHaveLength(1);
    await s.access.retainConfigurations("connector-core", ["record-a"]);
    expect(await s.access.list()).toHaveLength(1);
    await s.access.retainConfigurations("connector-core", []);
    expect(await s.access.list()).toEqual([]);
    expect(JSON.parse(await readFile(join(s.root, "access.json"), "utf8")).approvals).toEqual([]);
    const b = await s.access.register(owner, requirement);
    await approve(s.access, b.id, "owned");
    await b.dispose();
    await s.access.revoke(b.id);
    expect(await s.access.list()).toEqual([]);
  } finally { await s.cleanup(); }
});
