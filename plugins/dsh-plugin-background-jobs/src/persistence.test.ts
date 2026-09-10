import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SessionStorage } from "@amiba/dsh-plugin-session-storage";
import { BackgroundJobs } from "./service.js";
function runtime(root: string) {
  let changed: Function = () => {};
  let done: Function = () => {};
  const handlers: Record<string, Function> = {};
  const records = new Map<string, any>();
  const owner = {
    id: "s1",
    session: { header: { id: "s1" }, append: vi.fn() },
  };
  const ctx: any = {
    agents: { get: (id: string) => (id === "s1" ? owner : undefined) },
    sessionPersistence: {
      inspect: async (id: string) => {
        if (id !== "s1") throw new Error("Unknown session");
        return { meta: { id } };
      },
      locate: () => ({
        kind: "jsonl",
        path: join(root, "s1", "session.jsonl.zstd"),
      }),
    },
    logger: { error: vi.fn(), warn: vi.fn() },
    jobs: {
      onJobsChanged: (fn: Function) => {
        changed = fn;
        return () => {};
      },
      onJobDone: (fn: Function) => {
        done = fn;
        return () => {};
      },
      list: () => [...records.values()],
      get: (id: string) => {
        if (!records.has(id)) throw new Error("Unknown job");
        return records.get(id);
      },
      read: vi.fn(() => {
        throw new Error("must not consume");
      }),
      kill: vi.fn(),
    },
    on: (name: string, fn: Function) => {
      handlers[name] = fn;
    },
    effect: (fn: Function) => fn(),
  };
  const storage = new SessionStorage(ctx);
  ctx.amibaSessionStorage = storage;
  const service = new BackgroundJobs(ctx);
  return {
    ctx,
    service,
    storage,
    owner,
    handlers,
    records,
    start: async (id: string, time: number) =>
      handlers["tools/execute"](
        { agent: owner, callId: `dispatch-${time}` },
        async () => {
          records.set(id, {
            id,
            kind: "tool",
            status: "running",
            startedAt: time,
          });
          changed(owner);
        },
      ),
    finish: async (id: string) => {
      const job = records.get(id);
      Object.assign(job, {
        status: "completed",
        finishedAt: job.startedAt + 30,
      });
      changed(owner);
      await done(job, owner);
    },
  };
}
it("restores records, output and both call bindings without a live owner or jobs after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-jobs-restart-"));
  try {
    const a = runtime(root);
    await a.start("tool-1", 1000);
    a.service.present("s1", "tool-1", {
      title: "读取说明",
      toolName: "read",
      peekOutput: () => "saved before expanding",
    });
    await a.finish("tool-1");
    a.handlers["tools/result"](
      { agent: a.owner, callId: "collect-1", arguments: { job_id: "tool-1" } },
      { content: [{ type: "text", text: "collected" }] },
    );
    await a.start("tool-2", 2000); // Remains running at abrupt exit.
    await a.service.flushAll();
    await a.storage.close();
    const raw = await readFile(
      join(root, "s1/plugins/background-jobs/records.json"),
      "utf8",
    );
    expect(raw).toContain("读取说明");
    const b = runtime(root);
    b.ctx.agents.get = () => undefined;
    const history = await b.service.history("s1");
    const finished = history.find((r) => r.id === "tool-1")!;
    expect(finished).toMatchObject({
      status: "completed",
      callId: "dispatch-1000",
      resultCallIds: ["collect-1"],
      title: "读取说明",
    });
    expect(await b.service.inspect("s1", finished.recordId)).toMatchObject({
      outputAvailable: true,
      output: "collected",
    });
    expect(history.find((r) => r.id === "tool-2")).toMatchObject({
      status: "interrupted",
    });
    await expect(b.service.inspect("s2", finished.recordId)).rejects.toThrow();
    expect(() => b.service.stop("s1", finished.recordId)).toThrow();
    b.ctx.agents.get = (id: string) => (id === "s1" ? b.owner : undefined);
    await b.start("tool-1", 3000);
    await b.service.flushAll();
    const next = await b.service.history("s1");
    expect(next.filter((r) => r.id === "tool-1")).toHaveLength(2);
    expect(new Set(next.map((r) => r.recordId)).size).toBe(3);
    expect((await b.service.inspect("s1", finished.recordId)).title).toBe(
      "读取说明",
    );
    expect(a.ctx.jobs.read).not.toHaveBeenCalled();
    expect(b.ctx.jobs.read).not.toHaveBeenCalled();
    await b.storage.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("saves final preview even if the user never expands or collects the result", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-jobs-output-"));
  try {
    const a = runtime(root);
    await a.start("tool-1", 1000);
    a.service.present("s1", "tool-1", {
      title: "build",
      peekOutput: () => "BUILD_OK",
    });
    await a.finish("tool-1");
    await a.storage.close();
    const b = runtime(root);
    const [record] = await b.service.history("s1");
    expect((await b.service.inspect("s1", record!.recordId)).output).toBe(
      "BUILD_OK",
    );
    await b.storage.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
