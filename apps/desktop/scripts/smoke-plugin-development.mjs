import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDevelopmentProfile, managedDshEnvironment, resolveManagedDshRuntimeDir, resolveManagedDshRuntimePaths } from "@amiba/app-runtime/dsh-runtime";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const runtimeDir = resolveManagedDshRuntimeDir({ env: process.env });
// Spaces and URL fragment characters also require URL encoding for --import.
const sandbox = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "amiba dev # profile-")));
const base = resolveManagedDshRuntimePaths({ surface: "desktop", home: path.join(sandbox, "home"), runtimeDir });
const project = path.join(sandbox, "dsh-plugin-probe");
const events = path.join(sandbox, "events.jsonl");
let child, profile, logs = "";
try {
  await fs.mkdir(base.profileDir, { recursive: true });
  const original = JSON.stringify({ private: true, dependencies: {}, dsh: { profile: { bundles: [] } } });
  await fs.writeFile(base.profileManifest, original);
  await fs.writeFile(base.profilePatch, JSON.stringify([{ insert: [
    { id: "timer", name: "@deepseek-ai/cordis-plugin-timer" },
    { id: "hmr", name: "@deepseek-ai/cordis-plugin-hmr", disabled: true },
  ] }]));
  await fs.mkdir(path.join(project, "lib"), { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: "dsh-plugin-probe", version: "0.0.0", type: "module", main: "lib/index.js", exports: { ".": "./lib/index.js", "./package.json": "./package.json" } }));
  const source = version => `import {appendFileSync} from 'node:fs'; export function apply(ctx) { ctx.effect(() => { appendFileSync(process.env.PROBE_EVENTS, JSON.stringify({kind:'start',version:${version},pid:process.pid})+'\\n'); return () => appendFileSync(process.env.PROBE_EVENTS, JSON.stringify({kind:'stop',version:${version},pid:process.pid})+'\\n'); }); }`;
  await fs.writeFile(path.join(project, "lib/index.js"), source(1));
  profile = await createDevelopmentProfile(base, [project]);
  // The managed gateway and a linked plugin must see the same private Remote
  // registry, even when that plugin has its own workspace dependencies.
  await fs.symlink(path.join(workspace, "plugins/dsh-plugin-pets/node_modules"), path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(path.join(project, "protocol.mjs"), 'export * from "@deepseek-ai/dsh-typert-protocol"; export { Context } from "@deepseek-ai/cordis"; export { ToolRuntime } from "@deepseek-ai/dsh-tools";');
  const identityProbe = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const managed = createRequire(${JSON.stringify(base.entrypoint)});
    const plugin = await import(${JSON.stringify(pathToFileURL(path.join(project, 'protocol.mjs')).href)});
    const gateway = await import(pathToFileURL(managed.resolve('@deepseek-ai/dsh-typert-protocol')).href);
    const cordis = await import(pathToFileURL(managed.resolve('@deepseek-ai/cordis')).href);
    const tools = await import(pathToFileURL(managed.resolve('@deepseek-ai/dsh-tools')).href);
    assert.equal(plugin.Context, cordis.Context);
    assert.equal(plugin.ToolRuntime, tools.ToolRuntime);
    const service = { ping() {} };
    plugin.Remote(service.ping, {name:'ping', addInitializer(fn) { fn.call(service); }});
    assert.equal(gateway.remoteMethods(service)[0]?.method, 'ping');
  `;
  execFileSync(base.node, ['--import', pathToFileURL(profile.preload).href, '--input-type=module', '--eval', identityProbe]);

  assert.equal(await fs.readFile(base.profileManifest, "utf8"), original);
  assert.equal(await fs.realpath(path.join(profile.paths.profileDir, "node_modules/dsh-plugin-probe")), project);
  child = spawn(base.node, ["--import", pathToFileURL(profile.preload).href, base.entrypoint, "--profile", profile.paths.profileName, "--patch", profile.overlay], {
    env: { ...managedDshEnvironment(base), DSH_TELEMETRY_DISABLED: "1", PROBE_EVENTS: events }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => logs += chunk);
  child.stderr.on("data", chunk => logs += chunk);
  async function waitFor(version) {
    for (let i = 0; i < 200; i++) {
      const rows = (await fs.readFile(events, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      if (rows.some(row => row.kind === "start" && row.version === version)) return rows;
      if (child.exitCode !== null) break;
      await delay(100);
    }
    throw new Error(`Plugin ${version} did not activate: ${logs}`);
  }
  await waitFor(1);
  await delay(500);
  await fs.writeFile(path.join(project, "lib/index.js"), source(2));
  const rows = await waitFor(2);
  assert(rows.some(row => row.kind === "stop" && row.version === 1));
  assert(rows.every(row => row.pid === child.pid));
  assert.equal(await fs.readFile(base.profileManifest, "utf8"), original);
  const patchBefore = await fs.readFile(base.profilePatch, "utf8");
  await fs.writeFile(base.profilePatch, JSON.stringify([{ insert: [{ id: "existing", name: "dsh-plugin-probe", disabled: true, config: { saved: 42 } }] }]));
  const replacement = await createDevelopmentProfile(base, [project]);
  try {
    const overlay = JSON.parse(await fs.readFile(replacement.overlay, "utf8"));
    assert(!overlay.some(row => row.insert), "same-name development must not create a second entry or bypass a disabled entry");
    assert.deepEqual(JSON.parse(await fs.readFile(replacement.paths.profilePatch, "utf8"))[0].insert[0].config, { saved: 42 });
  } finally { await replacement.dispose(); await fs.writeFile(base.profilePatch, patchBefore); }
  console.log("Temporary development profile: attach, real DSH host HMR, disposal, same PID, installed profile unchanged — passed.");
} finally {
  if (child?.exitCode === null) { child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
  await profile?.dispose();
  await fs.rm(sandbox, { recursive: true, force: true });
}
