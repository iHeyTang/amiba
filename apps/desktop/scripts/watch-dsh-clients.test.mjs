import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const inputsPath = fileURLToPath(
  new URL("../../../scripts/dsh-client-inputs.mjs", import.meta.url),
);
const watcherUrl = new URL("./watch-dsh-clients.mjs", import.meta.url).href;
async function eventually(check, message, ms = 15000) {
  const end = Date.now() + ms;
  do {
    if (await check()) return;
    await delay(40);
  } while (Date.now() < end);
  assert.fail(message);
}

test(
  "on-demand compilation preserves artifacts and supports edits, shared dependencies, errors and shutdown",
  { timeout: 60000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "amiba-hmr-test-"));
    const runtimeDir = path.join(root, "runtime");
    await fs.mkdir(path.join(root, "bundles"));
    await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "packages/shared/package.json"),
      JSON.stringify({ name: "@amiba/shared" }),
    );
    const shared = path.join(root, "packages/shared/src/value.ts");
    await fs.writeFile(shared, 'export const shared = "shared-one"');
    for (const name of ["a", "b"]) {
      const dir = path.join(root, "plugins", name);
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: `@amiba/${name}`,
          dsh: { client: {} },
          dependencies: { "@amiba/shared": "workspace:*" },
        }),
      );
      await fs.writeFile(
        path.join(dir, "src/client.ts"),
        `import {shared} from "../../../packages/shared/src/value"; export const value = "${name}-one:" + shared`,
      );
      await fs.writeFile(
        path.join(dir, "vite.config.ts"),
        `import {clientInputs} from ${JSON.stringify(inputsPath)}; export default { plugins: [clientInputs({workspaceDir: ${JSON.stringify(root)}})], build: { target: "es2022", sourcemap: true, lib: {entry: "src/client.ts", formats: ["cjs"], fileName: () => "client.js"}, rollupOptions: {output: {inlineDynamicImports: true, banner: 'window.__ModuleLoader__.load({id:"@amiba/${name}",factory:(require)=>{', intro: 'var module={exports:{}}; var exports=module.exports;', footer: 'return module.exports;}});'}}}}`,
      );
      const lib = path.join(runtimeDir, "app/node_modules/@amiba", name, "lib");
      await fs.mkdir(lib, { recursive: true });
      await fs.writeFile(
        path.join(lib, "client.js"),
        "// verified existing artifact",
      );
      await fs.writeFile(
        path.join(lib, "index.js"),
        "// host artifact must survive",
      );
    }
    const artifact = (name) =>
      path.join(runtimeDir, "app/node_modules/@amiba", name, "lib/client.js");
    const read = (name) => fs.readFile(artifact(name), "utf8");
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {watchClients} from ${JSON.stringify(watcherUrl)}; await watchClients(${JSON.stringify({ workspaceDir: root, runtimeDir })})`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let logs = "";
    child.stdout.on("data", (chunk) => (logs += chunk));
    child.stderr.on("data", (chunk) => (logs += chunk));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      await fs.rm(root, { recursive: true, force: true });
    });
    await eventually(
      () => logs.includes("watching 2"),
      "watcher not ready: " + logs,
    );
    t.diagnostic(`ready in ${Math.round(performance.now() - started)}ms`);
    assert.equal(await read("a"), "// verified existing artifact");
    assert.equal(await read("b"), "// verified existing artifact");
    const source = path.join(root, "plugins/a/src/client.ts");
    // Exercise the installed DSH HMR implementation, including its content-revision
    // check and SSE frame. No running desktop or user profile is touched.
    const { apply } = await import(
      new URL(
        "../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js",
        import.meta.url,
      )
    );
    const effects = [],
      listeners = new Set(),
      revisions = new Map(),
      frames = [];
    let handler;
    apply(
      {
        clientModules: {
          graph: () => ({
            entries: ["a", "b"].map((name) => ({ id: `@amiba/${name}` })),
          }),
          clientPath: (id) => artifact(id.split("/")[1]),
          rebuilt(id) {
            const rev = createHash("sha256")
              .update(readFileSync(artifact(id.split("/")[1])))
              .digest("hex");
            if (revisions.get(id) !== rev) {
              revisions.set(id, rev);
              for (const listener of listeners) listener(id, rev);
            }
          },
          onGraphChanged: () => () => {},
          onRebuilt: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
        },
        webServer: {
          register: (route) => {
            handler = route.handler;
            return () => {};
          },
        },
        effect: (callback) => effects.push(callback()),
        logger: {
          warn: (error) => {
            throw error;
          },
        },
      },
      { pollIntervalMs: 20 },
    );
    const response = new EventEmitter();
    response.writeHead = () => {};
    response.write = (data) => {
      if (data.startsWith("data: ")) frames.push(JSON.parse(data.slice(6)));
    };
    response.destroy = () => response.emit("close");
    handler({ method: "GET" }, response);
    t.after(() => effects.forEach((dispose) => dispose()));
    const editStart = performance.now();
    await fs.writeFile(
      source,
      'import {shared} from "../../../packages/shared/src/value"; export const value = "a-two:" + shared',
    );
    await eventually(
      async () => (await read("a")).includes("a-two:"),
      "edit not published: " + logs,
    );
    t.diagnostic(
      `edit published in ${Math.round(performance.now() - editStart)}ms`,
    );
    assert.equal(
      await read("b"),
      "// verified existing artifact",
      "unrelated plugin rebuilt",
    );
    await eventually(
      () =>
        frames.some(
          (frame) => frame.type === "rebuilt" && frame.id === "@amiba/a",
        ),
      "DSH did not emit rebuilt SSE",
    );
    let loaded;
    vm.runInNewContext(await read("a"), {
      window: { __ModuleLoader__: { load: (row) => (loaded = row) } },
    });
    assert.equal(loaded.id, "@amiba/a");
    assert.equal(
      loaded.factory(() => {
        throw new Error("unexpected external");
      }).value,
      "a-two:shared-one",
    );
    const good = await read("a");
    // A shared package file that this client never parsed should not trigger it.
    const updateCount = (logs.match(/updated @amiba\/a/g) || []).length;
    await fs.writeFile(
      path.join(root, "packages/shared/src/unrelated.ts"),
      "export const unrelated = true",
    );
    await delay(400);
    assert.equal((logs.match(/updated @amiba\/a/g) || []).length, updateCount);
    await fs.writeFile(source, "export const = broken syntax");
    await eventually(
      () => logs.includes("Transform failed"),
      "compile error not reported: " + logs,
    );
    assert.equal(await read("a"), good, "failed build replaced valid artifact");
    await fs.writeFile(
      source,
      'import {shared} from "../../../packages/shared/src/value"; export const value = "a-fixed:" + shared',
    );
    await eventually(
      async () => (await read("a")).includes("a-fixed:"),
      "did not recover: " + logs,
    );
    await fs.writeFile(shared, 'export const shared = "shared-two"');
    await eventually(
      async () =>
        (await read("a")).includes("shared-two") &&
        (await read("b")).includes("shared-two"),
      "transitive shared edit not published: " + logs,
    );
    assert.equal(
      await fs.readFile(
        path.join(path.dirname(artifact("a")), "index.js"),
        "utf8",
      ),
      "// host artifact must survive",
    );
    const sourceMap = JSON.parse(await fs.readFile(artifact("a") + ".map", "utf8"));
    assert.equal(sourceMap.version, 3);
    for (const source of sourceMap.sources) {
      assert.ok(path.isAbsolute(source), "staged sourcemap retained a relative source path");
      await fs.access(source);
    }
    await fs.writeFile(source, 'export const value = "shutdown"');
    await delay(200);
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    assert.equal(
      (await fs.readdir(path.join(root, "plugins/a"))).some((name) =>
        name.startsWith(".client-build-"),
      ),
      false,
      "staging directory leaked",
    );
  },
);
