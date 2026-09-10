import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CronService } from "./service.js";
import { DshCronStore } from "./store.js";

function harness(now: () => number) {
  const followup = vi.fn();
  const whenIdle = vi.fn().mockResolvedValue(undefined);
  const dispose = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn(async (_options: unknown) => ({
    agent: { followup, whenIdle },
    dispose,
  }));
  const posted: unknown[] = [];
  const ctx = {
    agents: { create },
    amibaNotifications: { post: (input: unknown) => posted.push(input) },
    reflect: {
      get: (name: string) =>
        name === "agentDefaultModel"
          ? { currentSelection: () => ({ provider: "p", model: "m" }) }
          : undefined,
    },
  };
  const store = new DshCronStore(mkdtempSync(join(tmpdir(), "amiba-cron-")));
  const service = new CronService(ctx as never, store, now);
  return { service, store, create, followup, dispose, whenIdle, posted };
}

describe("cron service", () => {
  it("creates, lists, updates and removes durable tasks", async () => {
    const { service } = harness(() => 1_000_000);
    const created = await service.create({
      name: "daily digest",
      prompt: "整理今天的新闻",
      rule: { kind: "every", everySeconds: 3600 },
    });
    expect(created.enabled).toBe(true);
    expect(created.nextRunAt).toBe(1_000_000 + 3_600_000);

    const toggled = await service.update(created.id, { enabled: false });
    expect(toggled.enabled).toBe(false);
    expect(toggled.nextRunAt).toBeNull();

    await service.removeTask(created.id);
    expect(await service.list()).toEqual([]);
    service.dispose();
  });

  it("refuses empty names, empty prompts, and bad rules at the boundary", async () => {
    const { service } = harness(() => 0);
    await expect(
      service.create({
        name: " ",
        prompt: "x",
        rule: { kind: "every", everySeconds: 3600 },
      }),
    ).rejects.toThrow(/name is required/u);
    await expect(
      service.create({
        name: "x",
        prompt: "",
        rule: { kind: "every", everySeconds: 3600 },
      }),
    ).rejects.toThrow(/prompt is required/u);
    await expect(
      service.create({
        name: "x",
        prompt: "x",
        rule: { kind: "every", everySeconds: 5 },
      }),
    ).rejects.toThrow(/at least 300/u);
    service.dispose();
  });

  it("runNow spawns a FRESH session, follows up the prompt, and records the run", async () => {
    const { service, create, followup, posted } = harness(() => 2_000_000);
    const created = await service.create({
      name: "报表",
      prompt: "生成每日报表",
      rule: { kind: "every", everySeconds: 3600 },
    });
    const ran = await service.runNow(created.id);

    expect(create).toHaveBeenCalledTimes(1);
    const options = create.mock.calls[0]![0] as { sessionId: string };
    expect(String(options.sessionId)).toMatch(/^session-/u);
    expect(ran.lastSessionId).toBe(String(options.sessionId));
    expect(ran.lastRunAt).toBe(2_000_000);

    expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0]![0] as {
      role: string;
      content: Array<{ type: string; text?: string }>;
    };
    expect(message.role).toBe("user");
    expect(message.content).toEqual([{ type: "text", text: "生成每日报表" }]);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ title: "报表" });
    service.dispose();
  });

  it("seeds the fresh session with an absolute cwd and the default model selection", async () => {
    // A session without `cwd` fails its first turn: agent presets reference
    // `{{cwd}}` during prompt assembly (seen live as `prompt variable
    // "{{cwd}}" has no value for this assembly`).
    const { service, create } = harness(() => 4_000_000);
    const created = await service.create({
      name: "x",
      prompt: "y",
      rule: { kind: "every", everySeconds: 3600 },
    });
    await service.runNow(created.id);
    const options = create.mock.calls[0]![0] as {
      meta?: { cwd?: string };
      agentOptions?: { provider: string; model: string };
    };
    expect(options.meta?.cwd).toMatch(/^\//u);
    expect(options.agentOptions).toEqual({ provider: "p", model: "m" });
    service.dispose();
  });

  it("disposes the run's agent handle once it goes idle — never leaks it", async () => {
    const { service, dispose, whenIdle } = harness(() => 3_000_000);
    const created = await service.create({
      name: "x",
      prompt: "y",
      rule: { kind: "every", everySeconds: 3600 },
    });
    await service.runNow(created.id);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(whenIdle).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it("start() runs a missed fire exactly for tasks that opted into catch-up", async () => {
    let now = 10_000_000;
    const { service, store, create } = harness(() => now);
    await service.create({
      name: "opted in",
      prompt: "run me",
      rule: { kind: "every", everySeconds: 3600 },
      catchUp: true,
    });
    await service.create({
      name: "opted out",
      prompt: "skip me",
      rule: { kind: "every", everySeconds: 3600 },
    });
    service.dispose();

    // The runtime was down across the fire point; a new service starts late.
    now = 10_000_000 + 2 * 3_600_000;
    const restarted = new CronService(
      { agents: { create } } as never,
      store,
      () => now,
    );
    await restarted.start();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    restarted.dispose();
  });
});

describe("cron timer loop", () => {
  // 2026-09-05 09:00 Asia/Shanghai.
  const NINE_AM_SHANGHAI = Date.UTC(2026, 8, 5, 1, 0, 0);
  const daily = {
    kind: "daily",
    time: "09:00",
    timeZone: "Asia/Shanghai",
  } as const;

  it("fires a daily task when the timer wakes shortly AFTER the target instant", async () => {
    vi.useFakeTimers();
    try {
      let now = NINE_AM_SHANGHAI - 1_000;
      const { service, create } = harness(() => now);
      await service.create({ name: "digest", prompt: "go", rule: daily });

      // Real timers never wake early and routinely wake a millisecond late.
      now = NINE_AM_SHANGHAI + 1;
      await vi.advanceTimersByTimeAsync(1_001);

      // The wake reads and writes the store on real fs promises.
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () => {
        const [task] = await service.list();
        expect(task!.lastRunAt).toBe(NINE_AM_SHANGHAI + 1);
      });
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires an interval task that comes due while the timer was pending", async () => {
    vi.useFakeTimers();
    try {
      let now = 5_000_000;
      const { service, create } = harness(() => now);
      await service.create({
        name: "poll",
        prompt: "go",
        rule: { kind: "every", everySeconds: 300 },
      });

      now += 300_000 + 7;
      await vi.advanceTimersByTimeAsync(300_007);

      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire the same daily instant twice across consecutive wakes", async () => {
    vi.useFakeTimers();
    try {
      let now = NINE_AM_SHANGHAI - 1_000;
      const { service, create } = harness(() => now);
      await service.create({ name: "digest", prompt: "go", rule: daily });

      now = NINE_AM_SHANGHAI + 1;
      await vi.advanceTimersByTimeAsync(1_001);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      // Something else re-arms and wakes the loop a minute later.
      await service.update((await service.list())[0]!.id, { catchUp: false });
      now = NINE_AM_SHANGHAI + 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      await service.list(); // settle the wake's store round-trip

      expect(create).toHaveBeenCalledTimes(1);
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a task created after today's fire point waits for tomorrow even when another task wakes the loop", async () => {
    vi.useFakeTimers();
    try {
      let now = NINE_AM_SHANGHAI + 30 * 60_000; // 09:30
      const { service, create } = harness(() => now);
      await service.create({ name: "late", prompt: "go", rule: daily });
      await service.create({
        name: "poll",
        prompt: "go",
        rule: { kind: "every", everySeconds: 300 },
      });

      now += 300_000 + 1;
      await vi.advanceTimersByTimeAsync(300_001);

      // Only the interval task ran; the daily one is due tomorrow.
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const tasks = await service.list();
      expect(
        tasks.find((task) => task.name === "poll")!.lastRunAt,
      ).toBeDefined();
      expect(
        tasks.find((task) => task.name === "late")!.lastRunAt,
      ).toBeUndefined();
      expect(create).toHaveBeenCalledTimes(1);
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("durable cron run history", () => {
  it("keeps every run and completion through a service restart", async () => {
    let now = 1000;
    const { service, store } = harness(() => now);
    const task = await service.create({
      name: "digest",
      prompt: "go",
      rule: { kind: "every", everySeconds: 300 },
    });
    const first = await service.runNow(task.id);
    now = 2000;
    const second = await service.runNow(task.id);
    await vi.waitFor(async () =>
      expect(
        (await service.list())[0]?.runs?.every(
          (run) => run.finishedAt !== undefined,
        ),
      ).toBe(true),
    );
    service.dispose();
    const restarted = new CronService(
      {} as never,
      new DshCronStore(store.path.replace(/\/tasks.json$/u, "")),
      () => now,
    );
    const [loaded] = await restarted.list();
    expect(loaded?.runs?.map((run) => run.sessionId)).toEqual([
      second.lastSessionId,
      first.lastSessionId,
    ]);
    expect(loaded?.runs).toHaveLength(2);
    restarted.dispose();
  });

  it("recovers earlier runs from persisted origins and keeps the legacy last run", async () => {
    const { service, store } = harness(() => 1000);
    const task = await service.create({
      name: "digest",
      prompt: "go",
      rule: { kind: "every", everySeconds: 300 },
    });
    await store.mutate((tasks) =>
      tasks.map((entry) => ({
        ...entry,
        lastSessionId: "latest",
        lastRunAt: 900,
      })),
    );
    service.dispose();
    const inspect = vi.fn(async (id: string) => ({
      events: [
        {
          type: "user/message",
          time: 500,
          data: {
            source: {
              kind: "user",
              rpcId: id === "old" ? `cron:${task.id}:abc-123` : "desktop:abc",
            },
          },
        },
        { type: "turn/end", time: 600 },
      ],
    }));
    const restarted = new CronService(
      { sessionPersistence: { inspect } } as never,
      store,
      () => 1000,
    );
    const [loaded] = await restarted.list(["old", "ordinary"]);
    expect(loaded?.runs).toEqual([
      { sessionId: "latest", startedAt: 900 },
      { sessionId: "old", startedAt: 500, finishedAt: 600 },
    ]);
    await restarted.list(["old", "ordinary"]);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(
      (
        await new DshCronStore(store.path.replace(/\/tasks.json$/u, "")).list()
      )[0]?.runs,
    ).toHaveLength(2);
    restarted.dispose();
  });
});
