import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationLifecycle, conversationPeriod } from "./conversations.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const origin = { plugin: "lark", entry: "account-1", scope: "group-1" };
const daily = { cadence: "daily" as const, timeZone: "Asia/Shanghai" };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "conversation-lifecycle-")); roots.push(root);
  let now = Date.parse("2026-09-12T15:59:00Z");
  let sequence = 0;
  const dispose = vi.fn(async () => {});
  const create = vi.fn(async () => ({ sessionId: `session-${++sequence}`, dispose }));
  const factory = { create, isClosed: () => false };
  return { root, service: new ConversationLifecycle(root, () => now), factory, dispose,
    setTime: (time: string) => { now = Date.parse(time); } };
}
describe("plugin-owned conversations", () => {
  it("reads settings without creating storage and keeps snapshots isolated", async () => {
    const { service, factory, setTime } = await setup();
    expect((await service.view(origin)).history).toEqual([]);
    await expect(readFile(service.path)).rejects.toMatchObject({ code: "ENOENT" });
    const first = await service.resolve(origin, factory, daily);
    await service.setSharedResources(origin, [{ reference: "document", title: "Shared" }]);
    const snapshot = await service.view(origin);
    snapshot.policy.timeZone = "UTC";
    snapshot.sharedResources[0]!.title = "Changed";
    snapshot.history.length = 0;
    expect(await service.view(origin)).toMatchObject({ policy: daily, currentSessionId: first.sessionId, pendingNewConversation: false, sharedResources: [{ title: "Shared" }] });
    setTime("2026-09-13T16:01:00Z");
    expect((await service.view(origin)).pendingNewConversation).toBe(true);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect((await service.view({ ...origin, scope: "other" })).sharedResources).toEqual([]);
  });
  it("changes cadence without losing the saved zone or creating an empty session", async () => {
    const { service, factory } = await setup();
    await service.resolve(origin, factory, daily);
    await service.configureCadence(origin, "weekly");
    expect((await service.view(origin)).policy).toEqual({ ...daily, cadence: "weekly" });
    expect(factory.create).toHaveBeenCalledTimes(1);
    await expect(service.configureCadence(origin, "invalid" as never)).rejects.toThrow("Invalid conversation cadence");
    expect((await service.view(origin)).policy.cadence).toBe("weekly");
    await service.newConversation(origin);
    expect((await service.view(origin)).pendingNewConversation).toBe(true);
  });
  it("rotates on the first message after local midnight and retains old routing", async () => {
    const { service, factory, setTime, dispose } = await setup();
    const first = await service.resolve(origin, factory, daily);
    setTime("2026-09-12T16:01:00Z");
    expect(factory.create).toHaveBeenCalledTimes(1);
    const second = await service.resolve(origin, factory, daily);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(await service.originForSession(first.sessionId)).toEqual(origin);
    expect((await service.history(origin)).map((segment) => segment.sessionId)).toEqual([first.sessionId, second.sessionId]);
    expect(dispose).not.toHaveBeenCalled();
  });
  it("creates only one segment for concurrent incoming messages", async () => {
    const { service, factory } = await setup();
    const sessions = await Promise.all(Array.from({ length: 20 }, () => service.resolve(origin, factory, daily)));
    expect(new Set(sessions.map((segment) => segment.sessionId)).size).toBe(1);
    expect(factory.create).toHaveBeenCalledTimes(1);
  });
  it("keeps policy, current binding and history across restart", async () => {
    const { root, service, factory, setTime } = await setup();
    await service.resolve(origin, factory, daily);
    await service.configure(origin, { ...daily, cadence: "weekly" });
    setTime("2026-09-13T01:00:00Z");
    const current = await service.resolve(origin, factory);
    const restored = new ConversationLifecycle(root, () => Date.parse("2026-09-13T12:00:00Z"));
    expect(await restored.resolve(origin, factory)).toEqual(current);
    expect(await restored.history(origin)).toHaveLength(2);
  });
  it("isolates history by plugin, account and conversation", async () => {
    const { service, factory } = await setup();
    const first = await service.resolve(origin, factory, daily);
    for (const different of [{ ...origin, plugin: "dingtalk" }, { ...origin, entry: "other-account" }, { ...origin, scope: "private-chat" }]) {
      expect(await service.history(different)).toEqual([]);
      await expect(service.adopt(different, first.sessionId, first.createdAt)).rejects.toThrow(/ownership/);
    }
  });
  it("supports manual rollover without creating empty sessions", async () => {
    const { service, factory, setTime } = await setup();
    const first = await service.resolve(origin, factory, { ...daily, cadence: "manual" });
    setTime("2027-01-01T00:00:00Z");
    expect(await service.resolve(origin, factory)).toEqual(first);
    await service.newConversation(origin);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect((await service.resolve(origin, factory)).sessionId).not.toBe(first.sessionId);
  });
  it("migrates an old binding once and never replaces the newer current session", async () => {
    const { service, factory } = await setup();
    await service.adopt(origin, "legacy", Date.parse("2026-01-01"), daily);
    const current = await service.resolve(origin, factory);
    await service.adopt(origin, "legacy", Date.parse("2026-01-01"), daily);
    expect(await service.resolve(origin, factory)).toEqual(current);
    expect(await service.history(origin)).toHaveLength(2);
  });
  it("fails closed on corrupt ownership instead of overwriting history", async () => {
    const { service, factory } = await setup();
    await writeFile(service.path, "{broken");
    await expect(service.resolve(origin, factory)).rejects.toThrow();
    expect(factory.create).not.toHaveBeenCalled();
    expect(await readFile(service.path, "utf8")).toBe("{broken");
  });
  it("recovers the write queue after creation fails", async () => {
    const { service, factory } = await setup();
    factory.create.mockRejectedValueOnce(new Error("offline"));
    await expect(service.resolve(origin, factory, daily)).rejects.toThrow("offline");
    await expect(service.resolve(origin, factory, daily)).resolves.toMatchObject(origin);
  });
  it("starts a fresh session for an explicitly closed current segment", async () => {
    const { service, factory } = await setup();
    const first = await service.resolve(origin, factory, daily);
    const second = await service.resolve(origin, { ...factory, isClosed: () => true });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(await service.originForSession(first.sessionId)).toEqual(origin);
  });
});
it("uses Monday week boundaries and calendar days across DST", () => {
  const weekly = { ...daily, cadence: "weekly" as const };
  expect(conversationPeriod(Date.parse("2026-09-13T15:59:00Z"), weekly)).toContain("2026-09-07");
  expect(conversationPeriod(Date.parse("2026-09-13T16:00:00Z"), weekly)).toContain("2026-09-14");
  const ny = { ...daily, timeZone: "America/New_York" };
  expect(conversationPeriod(Date.parse("2026-03-08T05:00:00Z"), ny)).toContain("2026-03-08");
  expect(conversationPeriod(Date.parse("2026-03-09T03:59:00Z"), ny)).toContain("2026-03-08");
  expect(conversationPeriod(Date.parse("2026-03-09T04:00:00Z"), ny)).toContain("2026-03-09");
});


it("resolves submit through the owning plugin and refuses an unavailable or mismatched owner", async () => {
  const { service, factory } = await setup();
  expect(await service.prepareSubmit("ordinary")).toBe("ordinary");
  const first = await service.resolve(origin, factory, daily);
  await expect(service.prepareSubmit(first.sessionId)).rejects.toThrow("owner_unavailable");
  const unregister = service.registerSubmitHandler(origin.plugin, async (_origin, id) => id);
  expect(await service.prepareSubmit(first.sessionId)).toBe(first.sessionId);
  unregister();
  service.registerSubmitHandler(origin.plugin, async () => "ordinary");
  await expect(service.prepareSubmit(first.sessionId)).rejects.toThrow("ownership mismatch");
});
it("viewing an entry after midnight does not create a new segment", async () => {
  const { service, factory, setTime } = await setup();
  const first = await service.resolve(origin, factory, daily);
  setTime("2026-10-01T00:00:00Z");
  expect(await service.resolve(origin, factory, undefined, false)).toEqual(first);
  expect(factory.create).toHaveBeenCalledTimes(1);
  expect((await service.resolve(origin, factory)).sessionId).not.toBe(first.sessionId);
});
