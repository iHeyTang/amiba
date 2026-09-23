import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir } from "node:fs/promises";

// Exercise the installed, patched native executor, not a copy of the policy.
const modules = new URL("../../../../node_modules/.pnpm/", import.meta.url);
const directory = (await readdir(modules)).find((name) =>
  name.startsWith("@deepseek-ai+dsh-llm-retry@0.1.5-rc.2_patch_hash="),
);
assert.ok(directory, "install the patched dependency before testing");
const { apply } = await import(
  new URL(
    `${directory}/node_modules/@deepseek-ai/dsh-llm-retry/lib/index.js`,
    modules,
  )
);
function fixture(policyOverrides = {}) {
  let projection, handler, dispose;
  let state = {};
  const events = [];
  const ctx = {
    sessionProjections: {
      register(value) {
        projection = value;
      },
      stateOf() {
        return state;
      },
    },
    on(_name, fn) {
      handler = fn;
      return () => {};
    },
    effect(fn) {
      dispose = fn();
    },
    logger: { warn() {} },
  };
  apply(ctx, {}, { random: () => 0.5 });
  const controller = new AbortController();
  const payload = {
    agent: {
      session: {
        append(type, data) {
          const event = { type, data };
          events.push(event);
          state = projection.apply(state, event);
        },
      },
    },
    turn: 1,
    step: 2,
    provider: "deepseek",
    signal: controller.signal,
    failure: { code: "TRANSPORT", message: "stream failed" },
    retryPolicy: {
      mode: "normal",
      maxRetries: 2,
      retryableCodes: ["TRANSPORT", "TIMEOUT", "SERVER"],
      initialDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
      ...policyOverrides,
    },
  };
  return {
    events,
    controller,
    payload,
    dispose,
    run: () => handler(payload, async () => undefined),
  };
}
test("network outages outlive the finite budget and preserve the request step", async () => {
  const f = fixture();
  for (let i = 0; i < 7; i++)
    assert.deepEqual(await f.run(), { kind: "retry" });
  assert.equal(f.events.filter((e) => e.type === "llm/retry").length, 7);
  assert.ok(f.events.every((e) => e.data.turn === 1 && e.data.step === 2));
  assert.equal(f.events.at(-1).data.retry, 7);
  await f.dispose();
});
test("stop cancels the backoff without starting another request", async () => {
  const f = fixture({ initialDelayMs: 30000, maxDelayMs: 30000 });
  const pending = f.run();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.controller.abort();
  assert.equal(await pending, undefined);
  assert.equal(
    f.events.filter((e) => e.type === "llm/retry-started").length,
    0,
  );
  await f.dispose();
});
test("credentials, excluded errors and disabled retries do not loop", async () => {
  for (const overrides of [
    {},
    { maxRetries: 0 },
    { retryableCodes: ["SERVER"] },
  ]) {
    const f = fixture(overrides);
    if (!Object.keys(overrides).length)
      f.payload.failure.code = "INVALID_CREDENTIAL";
    assert.equal(await f.run(), undefined);
    assert.equal(f.events.length, 0);
    await f.dispose();
  }
});
test("server failures retain their finite budget", async () => {
  const f = fixture();
  f.payload.failure.code = "SERVER";
  assert.deepEqual(await f.run(), { kind: "retry" });
  assert.deepEqual(await f.run(), { kind: "retry" });
  assert.equal(await f.run(), undefined);
  await f.dispose();
});
