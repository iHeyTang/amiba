import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the installed DSH CLI and Loader, without modifying a user's profile
// or the application's runtime. No Amiba-specific plugin loader is involved.
const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = path.join(
  workspace,
  "packages/app-runtime/resources/dsh-runtime",
);
const node = path.join(
  runtime,
  process.platform === "win32" ? "node/node.exe" : "node/bin/node",
);
const entry = path.join(
  runtime,
  "app/node_modules/@deepseek-ai/dsh/lib/bin.js",
);
const sandbox = await fs.realpath(
  await fs.mkdtemp(path.join(tmpdir(), "amiba-local-plugin-")),
);
const home = path.join(sandbox, "home");
const profile = path.join(home, "profiles/local-plugin-smoke");
const project = path.join(sandbox, "dsh-plugin-probe");
const events = path.join(sandbox, "events.jsonl");
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: "1",
  PROBE_EVENTS: events,
  PATH: [
    path.dirname(node),
    path.join(runtime, "app/node_modules/.bin"),
    process.env.PATH,
  ].join(path.delimiter),
};
let child;
let logs = "";
try {
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(path.join(project, "lib"), { recursive: true });
  await fs.writeFile(
    path.join(profile, "package.json"),
    JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }),
  );
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      name: "dsh-plugin-probe",
      version: "0.0.0",
      type: "module",
      exports: "./lib/index.js",
    }),
  );
  const source = (version) =>
    `import { appendFileSync } from 'node:fs';\nexport function apply(ctx) { ctx.effect(() => { appendFileSync(process.env.PROBE_EVENTS, JSON.stringify({event:'start',version:${version},pid:process.pid})+'\\n'); return () => appendFileSync(process.env.PROBE_EVENTS, JSON.stringify({event:'stop',version:${version},pid:process.pid})+'\\n'); }, 'probe'); }\n`;
  await fs.writeFile(path.join(project, "lib/index.js"), source(1));
  const added = spawnSync(
    node,
    [
      entry,
      "plugin",
      "--profile",
      "local-plugin-smoke",
      "add",
      `link:${project}`,
      "--ignore-scripts",
    ],
    { env, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const manifest = JSON.parse(
    await fs.readFile(path.join(profile, "package.json")),
  );
  assert.match(manifest.dependencies["dsh-plugin-probe"], /^link:/);
  await fs.writeFile(
    path.join(profile, "cordis.patch.yml"),
    `- insert:\n    - id: timer\n      name: '@deepseek-ai/cordis-plugin-timer'\n    - id: hmr\n      name: '@deepseek-ai/cordis-plugin-hmr'\n      config:\n        root: [${JSON.stringify(path.join(project, "lib"))}]\n        debounce: 100\n`,
  );
  child = spawn(node, [entry, "--profile", "local-plugin-smoke"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  async function waitFor(version) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const lines = (await fs.readFile(events, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (lines.some((row) => row.event === "start" && row.version === version))
        return lines;
      if (child.exitCode !== null)
        throw new Error(`DSH exited before plugin ${version}: ${logs}`);
      await delay(100);
    }
    throw new Error(`Local plugin ${version} did not load: ${logs}`);
  }
  // Attach through the live profile patch after DSH has started.
  await delay(1000);
  await fs.appendFile(
    path.join(profile, "cordis.patch.yml"),
    "- insert:\n    - id: probe\n      name: dsh-plugin-probe\n",
  );
  await waitFor(1);
  // Let the module watcher settle, then simulate the plugin compiler's output.
  await delay(500);
  await fs.writeFile(path.join(project, "lib/index.js"), source(2));
  const lines = await waitFor(2);
  assert(lines.some((row) => row.event === "stop" && row.version === 1));
  assert(
    lines.every((row) => row.pid === child.pid),
    "The DSH process must stay alive across plugin reload.",
  );
  console.log(
    "DSH native local plugin smoke passed: profile link, live Loader mount, dispose/reload, unchanged DSH PID.",
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5_000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await fs.rm(sandbox, { recursive: true, force: true });
}
