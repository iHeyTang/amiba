import { describe, expect, it, vi } from "vitest";
import { featureSeed, requiredFeatures, SessionFeatures } from "./index.js";

describe("durable session features", () => {
  it("does not inherit plugin ownership through forked history", () => {
    const events = featureSeed("owner", "steward", 1);
    expect(requiredFeatures({ id: "owner", events })).toHaveLength(1);
    expect(requiredFeatures({ id: "fork", events })).toEqual([]);
  });
  it("installs once per agent, validates versions and rejects missing providers", () => {
    const service = new SessionFeatures();
    const ctx = {} as never;
    const bindings = requiredFeatures({
      id: "a",
      events: featureSeed("a", "steward", 1),
    });
    expect(() => service.ensure(ctx, bindings)).toThrow(/requires/);
    const install = vi.fn();
    const dispose = service.register("steward", { version: 1, install });
    expect(service.ensure(ctx, bindings)).toBe(true);
    expect(service.ensure(ctx, bindings)).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);
    expect(() =>
      service.ensure(ctx, [{ ...bindings[0]!, version: 2 }]),
    ).toThrow(/v2/);
    void dispose();
    expect(() => service.ensure(ctx, bindings)).toThrow(/requires/);
    expect(() =>
      service.assertReady({
        ctx,
        session: { id: "a", events: featureSeed("a", "steward", 1) },
      } as never),
    ).toThrow(/unavailable/);
  });
  it("does not silently replace a running agent's feature on hot reload", () => {
    const service = new SessionFeatures();
    const ctx = {} as never;
    const bindings = requiredFeatures({
      id: "a",
      events: featureSeed("a", "steward", 1),
    });
    const dispose = service.register("steward", { version: 1, install() {} });
    service.ensure(ctx, bindings);
    void dispose();
    service.register("steward", { version: 1, install() {} });
    expect(() => service.ensure(ctx, bindings)).toThrow(/close this agent/);
    expect(service.ensure({} as never, bindings)).toBe(true);
  });
});

it("round-trips feature bindings through the official session store", async () => {
  const { Session } = await import("@deepseek-ai/dsh-session");
  const header = {
    id: "a" as never,
    version: 0,
    createdAt: Date.now(),
    agentPreset: "code",
  };
  const session = Session.create(
    header.id,
    featureSeed("a", "steward", 1),
    header,
  );
  const restored = Session.fromRestore(
    header.id,
    JSON.parse(JSON.stringify(session.events)),
    header,
  );
  expect(requiredFeatures(restored)).toEqual([
    { sessionId: "a", plugin: "steward", version: 1 },
  ]);
});

it("cancels and drains live consumers when their provider unloads", async () => {
  const service = new SessionFeatures();
  const cancel = vi.fn(),
    whenIdle = vi.fn(async () => {});
  const agent = {
    ctx: {} as never,
    session: { id: "a", events: featureSeed("a", "steward", 1) },
    cancel,
    whenIdle,
  } as never;
  service.track(agent);
  const dispose = service.register("steward", { version: 1, install() {} });
  await dispose();
  expect(cancel).toHaveBeenCalledWith(
    { kind: "disposed" },
    { keepInbox: true },
  );
  expect(whenIdle).toHaveBeenCalledTimes(1);
  service.untrack(agent);
});
