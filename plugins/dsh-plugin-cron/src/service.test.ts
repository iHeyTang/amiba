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
      service.create({ name: " ", prompt: "x", rule: { kind: "every", everySeconds: 3600 } }),
    ).rejects.toThrow(/name is required/u);
    await expect(
      service.create({ name: "x", prompt: "", rule: { kind: "every", everySeconds: 3600 } }),
    ).rejects.toThrow(/prompt is required/u);
    await expect(
      service.create({ name: "x", prompt: "x", rule: { kind: "every", everySeconds: 5 } }),
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
