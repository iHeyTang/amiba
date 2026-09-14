import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DesktopExtensionHost, resolveDesktopExtension } from "../desktop-extensions.ts";
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "amiba-native-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
  write("package.json", JSON.stringify({ dependencies: { bundle: "1" } }));
  write("node_modules/bundle/package.json", JSON.stringify({ name: "bundle", dependencies: { browser: "1" } }));
  write("node_modules/bundle/node_modules/browser/package.json", JSON.stringify({ name: "browser", dsh: { native: "./native.cjs" } }));
  write("node_modules/bundle/node_modules/browser/native.cjs", "exports.create = () => ({call:()=>42, rendererCall:()=>43, dispose(){}})");
  return { root, manifest: path.join(root, "package.json"), write };
}
test("loads an installed bundled native entry and invalidates old leases on replacement", async t => {
  const f = fixture(t); const disposed = []; let generation = 0;
  const host = new DesktopExtensionHost({ profileManifest: () => f.manifest, context: { hostContentsId: () => 1, emit() {} },
    load: () => { const id = ++generation; return { create: () => ({ partitions: ["test"], call: () => id, rendererCall: () => id, dispose: () => disposed.push(id) }) }; } });
  const first = host.attach("browser", "first");
  assert.equal(host.attach("browser", "first"), first);
  assert.equal(await host.call(first, "open", {}, {}), 1);
  assert.equal(host.allowsPartition("test"), true);
  assert.throws(() => host.attach("browser", "second"), /already active/);
  host.detach(first);
  assert.equal(host.allowsPartition("test"), false);
  assert.throws(() => host.connect("browser"), /not active/);
  const second = host.attach("browser", "second");
  assert.notEqual(second, first);
  host.detachInstance("browser", "first");
  await assert.rejects(host.rendererCall(1, first, "open", {}), /unloaded/);
  assert.equal(await host.call(second, "open", {}, {}), 2);
  host.reset(); assert.deepEqual(disposed, [1, 2]);
});
test("rejects results and drops events from a revoked instance", async t => {
  const f = fixture(t); let resolve, emit; const events = [];
  const host = new DesktopExtensionHost({ profileManifest: () => f.manifest, context: { hostContentsId: () => 1, emit: (...args) => events.push(args) },
    load: () => ({ create: ctx => { emit = ctx.emit; return { call: () => new Promise(done => { resolve = done; }), rendererCall() {}, dispose() {} }; } }) });
  const lease = host.attach("browser", "one"); const pending = host.call(lease, "wait", {}, {});
  emit(1, "ready", {}); assert.equal(events.length, 1);
  host.reset(); emit(1, "late", {}); resolve("late result");
  await assert.rejects(pending, /unloaded/); assert.equal(events.length, 1);
});
test("resolves real bundled CommonJS and rejects uninstalled packages and escaped entries", async t => {
  const f = fixture(t);
  const host = new DesktopExtensionHost({ profileManifest: () => f.manifest, context: { hostContentsId: () => null, emit() {} } });
  assert.equal(await host.call(host.attach("browser", "one"), "test", {}, {}), 42);
  assert.throws(() => resolveDesktopExtension(f.manifest, "missing"), /not installed/);
  assert.throws(() => resolveDesktopExtension(f.manifest, "../browser"), /Invalid/);
  f.write("outside.cjs", "exports.create = () => ({})");
  f.write("node_modules/bundle/node_modules/browser/package.json", JSON.stringify({ name: "browser", dsh: { native: "../../../../outside.cjs" } }));
  assert.throws(() => resolveDesktopExtension(f.manifest, "browser"), /escapes/);
});

test("resolves hoisted native dependencies whose package.json is not exported", t => {
  const f = fixture(t);
  rmSync(path.join(f.root, "node_modules/bundle/node_modules/browser"), { recursive: true });
  f.write("node_modules/browser/package.json", JSON.stringify({ name: "browser", exports: { ".": "./index.js" }, dsh: { native: "./native.cjs" } }));
  f.write("node_modules/browser/index.js", "export {};");
  f.write("node_modules/browser/native.cjs", "exports.create = () => ({});");
  assert.equal(resolveDesktopExtension(f.manifest, "browser"), realpathSync(path.join(f.root, "node_modules/browser/native.cjs")));
});
