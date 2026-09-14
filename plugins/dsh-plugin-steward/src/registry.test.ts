import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationLifecycle } from "@amiba/dsh-plugin-session-features";
import { describe, expect, it, vi } from "vitest";
import { StewardRegistryStore } from "./registry-store.js";
import { StewardRegistryService } from "./registry.js";
import { harness } from "./test/service-harness.js";

const profile = (name: string) => ({
  name,
  responsibilities: `${name}的职责`,
  background: `${name}的背景`,
  context: `${name}的待办`,
});
export async function registryHarness() {
  const h = harness();
  const root = mkdtempSync(join(tmpdir(), "steward-registry-"));
  const lifecycle = new ConversationLifecycle(root);
  h.reflectServices.set("amibaConversations", lifecycle);
  const ctx = { ...h.ctx, amibaConversations: lifecycle };
  const store = new StewardRegistryStore(root);
  const registry = new StewardRegistryService(ctx as never, store, {
    defaultCwd: "/default",
  });
  await registry.initialize();
  return { ...h, ctx, root, lifecycle, registry, registryStore: store };
}
const turns = (reply: string) => [
  { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
  {
    type: "user/message",
    seq: 1,
    time: 1,
    data: { id: "u", role: "user", content: [{ type: "text", text: "work" }] },
  },
  {
    type: "assistant/message",
    seq: 2,
    time: 1,
    data: {
      turn: 0,
      step: 0,
      message: {
        id: "a",
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    },
  },
  {
    type: "turn/end",
    seq: 3,
    time: 10,
    data: { turn: 0, reason: { kind: "completed" } },
  },
];

describe("durable independent stewards", () => {
  it("migrates the legacy session, preset, cursor and old lifecycle without resetting them", async () => {
    const h = harness();
    const root = mkdtempSync(join(tmpdir(), "steward-migration-"));
    const legacy = {
      version: 1,
      stewardSessionId: "old",
      basePreset: "minimal",
      extensionVersion: 1,
      tasks: [
        {
          id: "t",
          title: "old task",
          sessionId: "task-session",
          cwd: "/work",
          origin: "adopted",
          status: "idle",
          lastReportedSeq: 41,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    writeFileSync(join(root, "state.json"), JSON.stringify(legacy));
    const lifecycle = new ConversationLifecycle(root);
    await lifecycle.adopt(
      { plugin: "amiba-steward", entry: "main", scope: "owner" },
      "older",
      1,
    );
    const store = new StewardRegistryStore(root);
    const registry = new StewardRegistryService(
      { ...h.ctx, amibaConversations: lifecycle } as never,
      store,
      { defaultCwd: "/default" },
    );
    await registry.initialize();
    expect((await registry.list())[0]).toMatchObject({
      id: "main",
      name: "大管家",
      state: legacy,
      sessionIds: ["old", "older"],
    });
    expect(JSON.parse(readFileSync(store.path, "utf8")).version).toBe(2);
    await registry.update("main", profile("重命名"));
    expect((await registry.list())[0]!.name).toBe("重命名");
    await registry.remove("main");
    expect(await new StewardRegistryStore(root).read()).toEqual({
      version: 2,
      instances: [],
    });
  });
  it("fails closed on corrupt or future data without overwriting it", async () => {
    const root = mkdtempSync(join(tmpdir(), "steward-corrupt-"));
    for (const raw of ["{broken", '{"version":999,"instances":[]}']) {
      writeFileSync(join(root, "state.json"), raw);
      await expect(
        new StewardRegistryStore(root).mutate((state) => state),
      ).rejects.toThrow();
      expect(readFileSync(join(root, "state.json"), "utf8")).toBe(raw);
    }
  });
  it("keeps zero instances across restart and can create from that state", async () => {
    const { registry, ctx, root, created } = await registryHarness();
    await registry.remove("main");
    const restored = new StewardRegistryService(
      ctx as never,
      new StewardRegistryStore(root),
      { defaultCwd: "/default" },
    );
    await restored.start();
    expect(created).toEqual([]);
    expect(await restored.list()).toEqual([]);
    const item = await restored.create(profile("新管家"));
    expect(item.id).not.toBe("main");
    expect(await restored.list()).toHaveLength(1);
    await restored.dispose();
  });
  it("one unavailable instance does not prevent the others from starting", async () => {
    const { registry, ctx } = await registryHarness();
    const second = await registry.create(profile("B"));
    ctx.agents.create.mockRejectedValueOnce(
      new Error("Unavailable base preset"),
    );
    await expect(registry.start()).rejects.toThrow("Some steward instances");
    expect(registry.profile(second.id).state.stewardSessionId).toBeTruthy();
    await registry.dispose();
  });
  it("renaming an instance updates its live session title without recreating it", async () => {
    const { registry, ctx, live, created } = await registryHarness();
    const id = await registry.engine("main").ensureStewardSessionId();
    await registry.update("main", profile("New name"));
    expect(ctx.sessionTitle.rename).toHaveBeenLastCalledWith(
      live.get(id)!.session,
      "New name",
    );
    expect(created).toHaveLength(1);
    await registry.dispose();
  });
  it("profile edits cannot overwrite task state from an earlier snapshot", async () => {
    const { registry } = await registryHarness();
    const previous = registry.profile("main");
    const task = await registry
      .engine("main")
      .dispatch({ newTask: { title: "New work" }, message: "go" });
    await registry.update("main", { ...previous, context: "Updated context" });
    expect(registry.profile("main").state.tasks.map((row) => row.id)).toContain(
      task.taskId,
    );
    await registry.dispose();
  });
  it("self deletion returns before the current turn becomes idle", async () => {
    const { registry, live, disposed } = await registryHarness();
    const id = await registry.engine("main").ensureStewardSessionId();
    let finish!: () => void;
    live.get(id)!.whenIdle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await registry.remove("main");
    expect(await registry.list()).toEqual([]);
    expect(disposed).not.toContain(id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish();
    await vi.waitFor(() => expect(disposed).toContain(id));
    await registry.dispose();
  });
  it("isolates task tools and enforces exclusive adoption, including racing adoptions", async () => {
    const { registry, persist, registryStore } = await registryHarness();
    const second = await registry.create(profile("B"));
    const a = registry.engine("main"),
      b = registry.engine(second.id);
    const work = await a.dispatch({
      newTask: { title: "A-work" },
      message: "go",
    });
    expect(await b.listTasks(true)).toEqual([]);
    await expect(b.readTask(work.taskId)).rejects.toThrow("unknown task");
    await expect(
      b.dispatch({ taskId: work.taskId, message: "steal" }),
    ).rejects.toThrow("unknown task");
    await expect(b.closeTask(work.taskId)).rejects.toThrow("unknown task");
    await expect(b.adopt({ sessionId: work.sessionId })).rejects.toThrow(
      "already_managed",
    );
    persist("race");
    const raced = await Promise.allSettled([
      a.adopt({ sessionId: "race" }),
      b.adopt({ sessionId: "race" }),
    ]);
    expect(
      raced.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      registryStore
        .snapshot()
        .instances.flatMap((row) => row.state.tasks)
        .filter((task) => task.sessionId === "race"),
    ).toHaveLength(1);
    await registry.dispose();
  });
  it("delivers each task only to its manager, including after a conversation rollover", async () => {
    const { registry, live, emit } = await registryHarness();
    const second = await registry.create(profile("B"));
    const a = registry.engine("main"),
      b = registry.engine(second.id);
    const aSession = await a.ensureStewardSessionId(),
      bSession = await b.ensureStewardSessionId();
    const work = await b.dispatch({
      newTask: { title: "B-work" },
      message: "go",
    });
    await b.conversationSettings("new");
    const next = await b.prepareStewardSession(bSession);
    for (const event of turns("B-only-result")) emit(work.sessionId, event);
    await vi.waitFor(() =>
      expect(live.get(next)!.followup).toHaveBeenCalledOnce(),
    );
    expect(live.get(aSession)!.followup).not.toHaveBeenCalled();
    expect(live.get(bSession)!.followup).not.toHaveBeenCalled();
    expect(JSON.stringify(live.get(next)!.followup.mock.calls)).toContain(
      "B-only-result",
    );
    expect(
      (await registry.forSession(bSession)).snapshot(),
    ).resolves.toMatchObject({ stewardSessionId: next });
    await registry.dispose();
  });
  it("deletes bindings but retains tasks/history, rejects stale tools and does not relay late replies", async () => {
    const { registry, persisted, live, emit, created } =
      await registryHarness();
    const engine = registry.engine("main");
    const steward = await engine.ensureStewardSessionId();
    const work = await engine.dispatch({
      newTask: { title: "Retained" },
      message: "go",
    });
    const count = created.length;
    await registry.remove("main");
    expect(persisted.has(work.sessionId)).toBe(true);
    expect(persisted.has(steward)).toBe(true);
    await expect(
      engine.dispatch({ taskId: work.taskId, message: "stale" }),
    ).rejects.toThrow();
    await expect(registry.forSession(steward)).rejects.toThrow("not_owned");
    for (const event of turns("late")) emit(work.sessionId, event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(live.get(steward)!.followup).not.toHaveBeenCalled();
    expect(created).toHaveLength(count);
    const replacement = await registry.create(profile("Replacement"));
    expect(
      await registry
        .engine(replacement.id)
        .adopt({ sessionId: work.sessionId }),
    ).toMatchObject({ kind: "adopted", existing: false });
    await registry.dispose();
  });
  it("recovers cold instances with their pinned backgrounds, contexts and completed task cursors", async () => {
    const { registry, registryStore, root, persisted } =
      await registryHarness();
    await registry.update("main", profile("A"));
    const b = await registry.create(profile("B"));
    const agent = await registry.engine(b.id).ensureStewardSessionId();
    const work = await registry
      .engine(b.id)
      .dispatch({ newTask: { title: "B-work" }, message: "go" });
    await registry.dispose();
    const cold = harness();
    const lifecycle = new ConversationLifecycle(root);
    cold.reflectServices.set("amibaConversations", lifecycle);
    for (const [id, record] of persisted)
      cold.persist(
        id,
        id === work.sessionId ? turns("offline reply") : record.events,
        record.meta,
      );
    const restored = new StewardRegistryService(
      { ...cold.ctx, amibaConversations: lifecycle } as never,
      new StewardRegistryStore(root),
      { defaultCwd: "/default" },
    );
    await restored.start();
    expect(restored.profile(b.id)).toMatchObject(profile("B"));
    expect(restored.profile("main")).toMatchObject(profile("A"));
    expect(cold.live.get(agent)!.followup).toHaveBeenCalledOnce();
    expect((await restored.engine(b.id).listTasks())[0]!.lastReportedSeq).toBe(
      3,
    );
    await restored.dispose();
  });
});
