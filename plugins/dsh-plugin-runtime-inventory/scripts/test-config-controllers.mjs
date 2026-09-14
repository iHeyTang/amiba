import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";
const packageDir = new URL(
  "../node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/",
  import.meta.url,
);
const source = readFileSync(new URL("client.js", packageDir), "utf8");
const standalone = readFileSync(
  new URL("card-controllers.js", packageDir),
  "utf8",
);
for (const name of [
  "card-form",
  "agent-loop-card-controller",
  "bash-card-controller",
  "web-search-card-controller",
]) {
  const start = source.indexOf(
    "\t\t//#region lib/types/client/" + name + ".js",
  );
  const end =
    source.indexOf("\t\t//#endregion", start) + "\t\t//#endregion".length;
  assert.ok(
    standalone.includes(source.slice(start, end)),
    "standalone controller must match the pinned package: " + name,
  );
}
const controllers = vm.runInNewContext(
  standalone
    .replace(/^import .*;$/m, "")
    .replace(
      /^export .*;$/m,
      "({BashCardController,AgentLoopCardController,WebSearchCardController});",
    ),
  {
    _deepseek_ai_dsh_client_runtime_client: {
      createSnapshotStore(initial) {
        let value = initial;
        const listeners = new Set();
        return {
          getSnapshot: () => value,
          subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          set(next) {
            value = next;
            for (const fn of listeners) fn();
          },
        };
      },
    },
  },
);
function scope(base) {
  let value = { ...base };
  let user = {};
  const listeners = new Set();
  const writes = [];
  let reject = false;
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    writes,
    reject() {
      reject = true;
    },
    getSnapshot: () => ({
      status: "ready",
      value,
      base,
      user,
      writable: true,
      mode: "host",
      revision: writes.length,
    }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async set(field, next) {
      writes.push([field, next]);
      if (!reject) {
        user = { ...user, [field]: next };
        value = { ...base, ...user };
        notify();
      }
    },
    async unset(field) {
      writes.push([field]);
      delete user[field];
      value = { ...base, ...user };
      notify();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("official Agent Loop stages, saves, resets inheritance and rejects invalid numbers", async () => {
  const settings = scope({ maxParallelToolCalls: 4 });
  const face = new controllers.AgentLoopCardController(settings).inject();
  const state = () => face.hooks.agentLoopCard.getSnapshot();
  face.edit("maxParallelToolCalls", "2");
  assert.equal(settings.writes.length, 0);
  assert.equal(state().dirty, true);
  face.save();
  await settle();
  assert.equal(settings.getSnapshot().value.maxParallelToolCalls, 2);
  assert.equal(state().dirty, false);
  face.resetField("maxParallelToolCalls");
  assert.equal(settings.writes.length, 1);
  face.save();
  await settle();
  assert.equal(settings.getSnapshot().value.maxParallelToolCalls, 4);
  face.edit("maxParallelToolCalls", "invalid");
  face.save();
  await settle();
  assert.equal(state().invalid, true);
  assert.equal(settings.writes.length, 2);
  face.discard();
  assert.equal(state().invalid, false);
});
test("official Shell preserves rejected drafts and identifies override presence", async () => {
  const settings = scope({ timeoutMs: 1000, maxOutputBytes: 8192 });
  const face = new controllers.BashCardController(settings).inject();
  settings.reject();
  face.edit("timeoutMs", "2000");
  face.save();
  await settle();
  const state = face.hooks.bashCard.getSnapshot();
  assert.equal(state.failed, true);
  assert.equal(state.timeoutMs.text, "2000");
  assert.equal(state.dirty, true);
});
test("Web Search never reads a secret literal and does not write a blank key", async () => {
  const settings = scope({ baseURL: "https://example.test", maxUses: 5 });
  const writes = [];
  const api = {
    credentials: {
      async describe() {
        return {
          result: {
            ok: true,
            value: {
              credentials: {
                DEEPSEEK_API_KEY: { configured: true, writable: true },
              },
            },
          },
        };
      },
      async set(value) {
        writes.push(value);
        return { result: { ok: true } };
      },
    },
  };
  const face = new controllers.WebSearchCardController(settings, api).inject();
  await settle();
  assert.equal(face.hooks.webSearchCard.getSnapshot().apiKey.text, "");
  face.edit("apiKey", "");
  face.edit("maxUses", "2");
  face.save();
  await settle();
  assert.equal(writes.length, 0);
  face.edit("apiKey", "test-fixture-only");
  face.save();
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ref, "DEEPSEEK_API_KEY");
  assert.equal(face.hooks.webSearchCard.getSnapshot().apiKey.text, "");
});
test("a rejected replacement key remains staged even when an older key exists", async () => {
  const settings = scope({});
  const api = {
    credentials: {
      async describe() {
        return {
          result: {
            ok: true,
            value: {
              credentials: {
                DEEPSEEK_API_KEY: { configured: true, writable: true },
              },
            },
          },
        };
      },
      async set() {
        return { result: { ok: false, error: { message: "rejected" } } };
      },
    },
  };
  const face = new controllers.WebSearchCardController(settings, api).inject();
  await settle();
  face.edit("apiKey", "test-fixture-only");
  face.save();
  await settle();
  const state = face.hooks.webSearchCard.getSnapshot();
  assert.equal(state.failed, true);
  assert.equal(state.apiKey.text, "test-fixture-only");
});
