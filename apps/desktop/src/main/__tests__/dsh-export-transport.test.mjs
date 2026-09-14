import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Run the installed, patched official controller; only its browser/slot hosts
// are fixtures. This guards the handoff URL independently of our dialog text.
const source = readFileSync(new URL("../../../../../plugins/dsh-plugin-ui-shell/node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js", import.meta.url), "utf8");
for (const [page, transport, origin, nativeOutcome] of [
  ["file:///app/index.html", "http://127.0.0.1:64892", "http://127.0.0.1:64892"],
  ["https://host.example/ui", "http://127.0.0.1:64892", "https://host.example"],
  ["file:///app/index.html", undefined, "http://dsh.internal"],
  ["file:///app/index.html", "http://127.0.0.1:64892", "http://127.0.0.1:64892", "ok"],
  ["file:///app/index.html", "http://127.0.0.1:64892", "http://127.0.0.1:64892", "reject"],
]) test(`official export handoff from ${page} via ${transport}`, async () => {
  let plugin, controller, requested, saved;
  runInNewContext(source, {
    URL, AbortController,
    ...(nativeOutcome ? {amiba:{dshClient:{download:async url=>{
      await Promise.resolve();
      if(nativeOutcome === "reject") throw new Error("Native handoff refused");
      saved=url;
    }}}} : {}),
    location: new URL(page),
    __AMIBA_DSH_TRANSPORT_URL__: transport,
    fetch: async (url, options) => { requested = String(url); assert.equal(options.method, "HEAD"); return { ok: true }; },
    document: { querySelector: () => ({}), createElement: () => ({ click() { saved = this.href; } }) },
    window: { __ModuleLoader__: { load: ({ factory }) => {
      plugin = factory(name => name === "@deepseek-ai/dsh-client-runtime/client" ? {
        createSnapshotStore: initial => { let state = structuredClone(initial); return {
          getSnapshot: () => state, update: fn => { fn(state); },
        }; },
      } : {});
    } } },
  });
  plugin.apply({
    provide: (_name, value) => { controller = value; },
    effect: () => {}, on: () => {}, slots: { inject: () => {} },
  });
  await controller.download("test-session");
  assert.equal(new URL(requested).origin, origin);
  if (nativeOutcome === "reject") {
    assert.equal(saved, undefined);
    assert.equal(controller.store.getSnapshot().bySession["test-session"].status, "error");
    return;
  }
  assert.equal(saved, requested);
  assert.equal(new URL(saved).searchParams.get("includeDescendants"), "true");
  assert.equal(controller.store.getSnapshot().bySession["test-session"].status, "success");
});
