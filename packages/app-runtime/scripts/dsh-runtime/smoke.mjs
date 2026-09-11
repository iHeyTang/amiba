/**
 * BUNDLE-COMPOSITION integration check (documented ruling).
 *
 * This script black-box smoke-tests the shipped `dsh-bundle-amiba-core`
 * composition end-to-end. It therefore MAY reference plugin package names
 * and drive their public RPC surfaces (e.g. `amibaMemory/status`) — that is
 * the point of the check, not a host→plugin coupling leak, which is why
 * `scripts/` directories are excluded from `verify-pluginization.mjs`.
 * The flip side: when a plugin is added to or pulled from the bundle,
 * this script must be updated in the same change.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtimePackageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workspaceDir = path.resolve(runtimePackageDir, "../..");
const runtimeDir = path.join(runtimePackageDir, "resources", "dsh-runtime");
const runtimeNode =
  process.platform === "win32"
    ? path.join(runtimeDir, "node", "node.exe")
    : path.join(runtimeDir, "node", "bin", "node");
const entrypoint = path.join(
  runtimeDir,
  "app",
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js",
);
const runtimeAppBinDir = path.join(runtimeDir, "app", "node_modules", ".bin");
const runtimeNodeBinDir =
  process.platform === "win32"
    ? path.join(runtimeDir, "node")
    : path.join(runtimeDir, "node", "bin");
const runtimeNpmCli =
  process.platform === "win32"
    ? path.join(runtimeDir, "node", "node_modules", "npm", "bin", "npm-cli.js")
    : path.join(
        runtimeDir,
        "node",
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
const bundleNames = [
  "dsh-bundle-amiba-core",
  "dsh-bundle-amiba-web",
  "dsh-bundle-amiba-desktop",
];
const bundleManifests = bundleNames.map((name) =>
  JSON.parse(
    readFileSync(
      path.join(workspaceDir, `bundles/${name}/package.json`),
      "utf8",
    ),
  ),
);
const pluginNames = Array.from(
  new Set(
    bundleManifests.flatMap((manifest) =>
      Object.keys(manifest.dependencies ?? {})
        .filter((name) => name.startsWith("@amiba/dsh-plugin-"))
        .map((name) => name.slice("@amiba/".length)),
    ),
  ),
).sort();
const plugins = pluginNames.map((name) =>
  path.join(
    runtimeDir,
    "app",
    "node_modules",
    "@amiba",
    name,
    "lib",
    "index.js",
  ),
);
const bundlePatches = bundleNames.map((name) =>
  path.join(
    runtimeDir,
    "app",
    "node_modules",
    "@amiba",
    name,
    "cordis.patch.yml",
  ),
);

for (const artifact of [runtimeNode, entrypoint, ...plugins, ...bundlePatches]) {
  if (!existsSync(artifact)) {
    throw new Error(
      `Managed DSH runtime artifact is missing: ${artifact}\nRun pnpm runtime:prepare first.`,
    );
  }
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "amiba-dsh-smoke-"));
const dshHome = path.join(temporaryRoot, "home");
const agentsHome = path.join(temporaryRoot, "agents");
const workspacePath = path.join(temporaryRoot, "workspace");
const profileName = "amiba-desktop";
const profileDir = path.join(dshHome, "profiles", profileName);
const pluginToken = randomBytes(32).toString("base64url");
let child;
let output = "";
let rpcSequence = 0;
const externalPackageName = "@amiba-smoke/dsh-plugin-external";

function remember(chunk) {
  output = `${output}${String(chunk)}`.slice(-128_000);
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const processChild = spawn(command, args, {
      cwd: options.cwd ?? temporaryRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processChild.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-256_000);
    });
    processChild.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-256_000);
    });
    processChild.once("error", reject);
    processChild.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} failed (code=${code ?? "null"}, signal=${signal ?? "none"}).\n${stdout}${stderr}`,
        ),
      );
    });
    const timer = setTimeout(() => {
      processChild.kill("SIGTERM");
      reject(new Error(`${command} timed out.\n${stdout}${stderr}`));
    }, 120_000);
  });
}

function managedCommandEnv() {
  return {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: agentsHome,
    PATH: [runtimeAppBinDir, runtimeNodeBinDir, process.env.PATH ?? ""].join(
      path.delimiter,
    ),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    PNPM_HOME: runtimeAppBinDir,
    npm_config_cache: path.join(temporaryRoot, "npm-cache"),
  };
}

async function waitForReady() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const inspect = (chunk) => {
      remember(chunk);
      const match = /(?:^|\n)dsh web: (http:\/\/[^\s]+)/u.exec(output);
      if (!match?.[1]) return;
      const url = new URL(match[1]);
      if (url.hostname !== "127.0.0.1" || !url.port) {
        finish(() =>
          reject(new Error(`DSH advertised an unsafe smoke URL: ${url.href}`)),
        );
        return;
      }
      finish(() => resolve(url.origin));
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      finish(() =>
        reject(
          new Error(
            `DSH exited before smoke readiness (code=${code ?? "null"}, signal=${signal ?? "none"}).\n${output}`,
          ),
        ),
      );
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new Error(`DSH smoke readiness timed out.\n${output}`)),
      );
    }, 90_000);
  });
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function rpc(baseUrl, method, payload = {}) {
  const rpcId = `smoke-${++rpcSequence}`;
  const endpoint = method
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(`${baseUrl}/api/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal: AbortSignal.timeout(35_000),
  });
  assert.equal(
    response.status,
    200,
    `${method} carrier returned HTTP ${response.status}`,
  );
  const envelope = await response.json();
  assert.equal(
    envelope.type,
    "server-response",
    `${method} returned the wrong envelope type`,
  );
  assert.equal(envelope.rpcId, rpcId, `${method} returned the wrong RPC id`);
  if (!envelope.result?.ok) {
    const error = envelope.result?.error;
    throw new Error(
      `${method} failed (${error?.code ?? "unknown"}): ${error?.message ?? "unknown error"}`,
    );
  }
  return envelope.result.value;
}

async function pluginRequest(baseUrl, route, options = {}) {
  const response = await fetch(new URL(route, baseUrl), {
    method: options.method ?? "GET",
    headers: {
      ...(options.authorized === false
        ? {}
        : { "x-amiba-plugin-token": pluginToken }),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(35_000),
  });
  const payload = await response.json();
  if (options.expectedStatus !== undefined) {
    assert.equal(
      response.status,
      options.expectedStatus,
      `${route} returned HTTP ${response.status}`,
    );
    return payload;
  }
  assert.ok(
    response.ok,
    `${route} returned HTTP ${response.status}: ${JSON.stringify(payload)}`,
  );
  assert.equal(
    payload.ok,
    true,
    `${route} rejected the request: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function waitForMuxSubscription(baseUrl, sessionId) {
  const url = new URL("/api/events.mux", `${baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (socket.readyState < WebSocket.CLOSING)
        socket.close(1000, "smoke complete");
      callback();
    };
    const onMessage = (event) => {
      try {
        assert.equal(
          typeof event.data,
          "string",
          "DSH mux emitted a non-text frame",
        );
        const envelope = JSON.parse(event.data);
        assert.equal(
          envelope.type,
          "server-request",
          "DSH mux returned the wrong envelope type",
        );
        assert.equal(
          typeof envelope.rpcId,
          "string",
          "DSH mux omitted its RPC id",
        );
        assert.equal(
          typeof envelope.method,
          "string",
          "DSH mux omitted its method",
        );
        if (
          envelope.payload?.type === "session/subscribed" &&
          envelope.payload.sessionId === sessionId
        ) {
          finish(resolve);
        }
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const onError = () =>
      finish(() => reject(new Error("DSH mux WebSocket failed")));
    const onClose = (event) =>
      finish(() =>
        reject(
          new Error(
            `DSH mux WebSocket closed before subscription (${event.code}): ${event.reason}`,
          ),
        ),
      );
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `DSH mux did not subscribe session ${sessionId} within 8000ms`,
            ),
          ),
        ),
      8_000,
    );

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

const checkFilter = process.env.AMIBA_DSH_SMOKE_CHECK?.trim();
let selectedChecks = 0;
async function check(name, callback) {
  // Profile composition is test setup, including for focused checks.
  if (checkFilter && !name.includes(checkFilter) && name !== "official DSH profile plugin install and composition") return;
  await callback();
  if (!checkFilter || name.includes(checkFilter)) selectedChecks += 1;
  process.stdout.write(`  ✓ ${name}\n`);
}

async function waitFor(description, callback, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await callback()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `${description} did not become observable within ${timeoutMs}ms${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

try {
  await Promise.all([
    mkdir(dshHome, { recursive: true }),
    mkdir(agentsHome, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
    mkdir(profileDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(profileDir, "package.json"),
      `${JSON.stringify(
        {
          name: "dsh-profile-amiba-desktop",
          private: true,
          dependencies: {},
          dsh: {
            profile: {
              bundles: [
                "@deepseek-ai/dsh-base",
                "@deepseek-ai/dsh-web-app",
                "@amiba/dsh-bundle-amiba-core",
                "@amiba/dsh-bundle-amiba-web",
                "@amiba/dsh-bundle-amiba-desktop",
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
    writeFile(path.join(profileDir, "cordis.patch.yml"), "[]\n", {
      mode: 0o600,
    }),
    writeFile(
      path.join(profileDir, "pnpm-workspace.yaml"),
      "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
      { mode: 0o600 },
    ),
  ]);

  const externalSource = path.join(temporaryRoot, "external-plugin-source");
  await mkdir(path.join(externalSource, "lib"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(externalSource, "package.json"),
      `${JSON.stringify(
        {
          name: externalPackageName,
          version: "0.0.0",
          type: "module",
          main: "./index.js",
          exports: {
            ".": "./index.js",
            "./client": "./lib/client.js",
            "./package.json": "./package.json",
          },
          files: ["index.js", "lib/client.js", "cordis.patch.yml"],
          dsh: {
            bundle: { patch: "./cordis.patch.yml" },
            client: {
              inject: [
                "@deepseek-ai/dsh-client-runtime",
                "@amiba/dsh-plugin-ui-shell",
              ],
              platform: "web",
            },
          },
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(externalSource, "index.js"),
      `export const name = "amiba-smoke-external";
export const inject = ["jobs", "tools", "amibaBackgroundJobs", "amibaMedia"];
export function apply(ctx) {
  const pending = new Map();
  const media = { prepare: async request => request, id: "smoke-media", describe: async () => ({ provider:"smoke-media",name:"Smoke", models:[{id:"fixture-image",name:"Fixture image",protocols:["fixture"],operations:["image.generate"]}],protocols:[{id:"fixture",operations:["image.generate"],documentation:[],instructions:"Local smoke fixture"}]}),
    generate: async () => ({status:"succeeded",artifacts:[{kind:"image",bytes:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=","base64")}]}) };
  ctx.effect(() => ctx.amibaMedia.registerProvider(media), "smoke-media");
  ctx.on("agent/created", ({agent}) => {
    void (async () => {
      try {
        const result = await ctx.tools.execute({name:"media_generate",arguments:{provider:"smoke-media",model:"fixture-image",protocol:"fixture",operation:"image.generate",parametersJson:JSON.stringify({exclusive:{keep:true}})},agent,signal:new AbortController().signal,callId:"smoke-media-"+agent.id});
        if (result.isError) throw new Error(result.error.message);
        const admitted = JSON.parse(result.value.json);
        await ctx.jobs.wait(admitted.jobId, 10000, agent);
        const record = await ctx.amibaMedia.inspect(agent.session.id, admitted.record.id);
        agent.session.append("amiba/smoke/media", {record}, {ignorable:true});
      } catch(error) { agent.session.append("amiba/smoke/media", {error:String(error)}, {ignorable:true}); }
    })();
  });
  ctx.tools.register({
    name: "amiba_smoke_download", description: "Isolated native asynchronous producer fixture",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: {}, additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute: (_args, exec) => {
      let finish;
      let preview = "";
      const done = new Promise(resolve => { finish = resolve; });
      const jobId = ctx.jobs.start({kind:"external-smoke", label:"Smoke download", owner:exec.agent,
        run:()=>({cancel(){finish({status:"killed"});}, done})});
      pending.set(exec.agent.id, () => { preview = "fixture.txt: 3 bytes"; finish({status:"completed",output:preview}); });
      ctx.amibaBackgroundJobs.present(exec.agent.id,jobId,{title:"Smoke download",peekOutput:()=>preview});
      return {job_id:jobId};
    },
  });
  ctx.on("agent/created", ({ agent }) => {
    const id = ctx.jobs.start({
      kind: "external-smoke", label: "PRIVATE_TOKEN=not-for-ui", owner: agent,
      run: () => ({ cancel() {}, done: Promise.resolve({ status: "completed" }) }),
    });
    // Claim model reporting: the presentation event must still be delivered.
    void ctx.jobs.wait(id, 1000, agent);
    void (async () => {
      const call = (name, args) => ctx.tools.execute({ name, arguments: args, agent, signal: new AbortController().signal, callId: "smoke-" + name + "-" + agent.id });
      try {
        const admission = await call("amiba_smoke_download", {});
        if (admission.isError) throw new Error(admission.error.message);
        const jobId = admission.value.job_id;
        const running = ctx.jobs.get(jobId, agent).status;
        const collected = ctx.jobs.wait(jobId, 5000, agent);
        pending.get(agent.id)();
        await collected;
        const result = await call("job_output", { job_id: jobId });
        if (result.isError) throw new Error(result.error.message);
        agent.session.append("amiba/smoke/background", { running, status:ctx.jobs.get(jobId,agent).status, output:result.content.filter(p=>p.type==="text").map(p=>p.text).join("\\n") }, { ignorable: true });
      } catch (error) {
        agent.session.append("amiba/smoke/background", { error: String(error) }, { ignorable: true });
      } finally { pending.delete(agent.id); }
    })();
  });
}
`,
    ),
    writeFile(
      path.join(externalSource, "cordis.patch.yml"),
      `- insert:\n    - id: amiba-smoke-external\n      name: "${externalPackageName}"\n`,
    ),
    writeFile(
      path.join(externalSource, "lib", "client.js"),
      `window.__ModuleLoader__.load({ id: "${externalPackageName}", factory: () => ({\n  name: "amiba-smoke-external-client",\n  inject: ["slots"],\n  async apply(ctx) {\n    const fiber = ctx.inject(["slots"], (injected) => injected.slots.inject("conversation.session.header.utilities", () => injected.slots.register({ name: "conversation.session.header.utilities", id: "external-smoke", order: 999 }, function ExternalSmokeSlot() { return null; })));\n    await fiber;\n    return async () => fiber.dispose();\n  },\n}) });\n`,
    ),
  ]);
  const packed = await runProcess(
    runtimeNode,
    [runtimeNpmCli, "pack", ".", "--json", "--pack-destination", temporaryRoot],
    { cwd: externalSource, env: managedCommandEnv() },
  );
  const packedResult = JSON.parse(packed.stdout);
  const externalArchive = path.join(temporaryRoot, packedResult[0].filename);
  await check(
    "official DSH profile plugin install and composition",
    async () => {
      await runProcess(
        runtimeNode,
        [
          entrypoint,
          "plugin",
          "--profile",
          profileName,
          "add",
          "-w",
          "--save-exact",
          `file:${externalArchive}`,
        ],
        { env: managedCommandEnv() },
      );
      const manifest = JSON.parse(
        await readFile(path.join(profileDir, "package.json"), "utf8"),
      );
      assert.ok(manifest.dependencies[externalPackageName]);
      assert.ok(manifest.dsh.profile.bundles.includes(externalPackageName));
      const dump = await runProcess(
        runtimeNode,
        [entrypoint, "--profile", profileName, "--dump-config"],
        { env: managedCommandEnv() },
      );
      assert.match(dump.stdout, /id: amiba-smoke-external/u);
    },
  );

  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const memoryViewerPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const startServer = () => spawn(
    runtimeNode,
    [entrypoint, "--profile", profileName, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        MEMOS_HOME: path.join(dshHome, "amiba-memos"),
        MEMOS_CONFIG_FILE: path.join(dshHome, "amiba-memos", "config.yaml"),
        AMIBA_MEMOS_VIEWER_PORT: String(memoryViewerPort),
        AMIBA_DSH_API_TOKEN: pluginToken,
        AMIBA_RUNTIME_GATEWAY_URL: "http://127.0.0.1:9",
        AMIBA_RUNTIME_GATEWAY_TOKEN: pluginToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child = startServer();
  let baseUrl = await waitForReady();
  process.stdout.write(`[dsh:smoke] running isolated DSH at ${baseUrl}\n`);

  await check("tool delivery origin", async () => {
    const inventory = await pluginRequest(baseUrl, "/api/amiba/tools");
    const tools = inventory.value.tools;
    assert.ok(tools.length > 0);
    assert.ok(tools.every(tool => ["builtin", "user"].includes(tool.source.distribution)));
    const origin = name => tools.filter(tool => tool.name === name).map(tool => tool.source.distribution);
    assert.deepEqual(origin("amiba_smoke_download"), ["user"]);
    for (const name of ["amiba_connect_add", "cron_create", "attachment_read_text", "memos_search", "bash"]) {
      assert.ok(origin(name).length > 0, `missing ${name}`);
      assert.ok(origin(name).every(value => value === "builtin"), `${name} is not builtin`);
    }
    process.stdout.write(`  Tool delivery: ${tools.filter(tool => tool.source.distribution === "builtin").length} builtin, ${tools.filter(tool => tool.source.distribution === "user").length} user\n`);
  });

  let preset;
  let settings;
  let workspace;
  let sessionId;

  await check(
    "DSH-composed Amiba Web Shell and native root plugin",
    async () => {
      let html = "";
      let graph;
      let ids = new Set();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await fetch(new URL("/", baseUrl), {
          signal: AbortSignal.timeout(35_000),
        });
        assert.equal(response.status, 200);
        html = await response.text();
        const manifestMatch =
          // Either spelling — see BOOT_SCRIPT_PATTERN in dsh-client-boot.ts.
          /<script>(?:window\.__DSH_BOOT__|globalThis\[\s*["']__DSH_BOOT__["']\s*\])\s*=\s*([\s\S]*?)<\/script>/u.exec(
            html,
          );
        assert.ok(manifestMatch?.[1], "DSH Web Shell omitted __DSH_BOOT__");
        graph = JSON.parse(manifestMatch[1]);
        ids = new Set(graph.entries.map((entry) => entry.id));
        if (
          ids.has("@amiba/dsh-plugin-catalog") &&
          ids.has("@amiba/dsh-plugin-memory-memos") &&
          ids.has("@amiba/dsh-plugin-connector-webhook") &&
          ids.has("@amiba/dsh-plugin-skills") &&
          ids.has("@amiba/dsh-plugin-mcp-manager") &&
          ids.has("@amiba/dsh-plugin-runtime-inventory") &&
          ids.has(externalPackageName) &&
          ids.has("@amiba/dsh-plugin-cron") && ids.has("@amiba/dsh-plugin-pets")
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        ids.has("@amiba/dsh-plugin-ui-shell"),
        "DSH client graph omitted Amiba's root plugin",
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-catalog"),
        `DSH client graph omitted Tools catalog's Client contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-memory-memos"),
        `DSH client graph omitted Memory's Client contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        !ids.has("@amiba/dsh-plugin-messaging-core"),
        "messaging-core must not contribute a Client plugin",
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-skills"),
        `DSH client graph omitted Skills' Client contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-mcp-manager"),
        `DSH client graph omitted MCP's Tools child contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-cron"),
        `DSH client graph omitted Cron's workspace contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-runtime-inventory"),
        `DSH client graph omitted the runtime plugin inventory: ${[...ids].join(", ")}`,
      );
      const externalClient = graph.entries.find(
        (entry) => entry.id === externalPackageName,
      );
      assert.deepEqual(externalClient.inject, [
        "@deepseek-ai/dsh-client-runtime",
        "@amiba/dsh-plugin-ui-shell",
      ]);
      const externalBundle = await fetch(new URL(externalClient.url, baseUrl), {
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(externalBundle.status, 200);
      assert.match(
        await externalBundle.text(),
        /conversation\.session\.header\.utilities/u,
      );
      assert.ok(
        !ids.has("@deepseek-ai/dsh-client-ui-layout"),
        "stock DSH layout still competes for root",
      );
      assert.ok(
        !ids.has("@deepseek-ai/dsh-client-ui-conversation"),
        "stock DSH conversation tree was not disabled",
      );
      for (const replacedClientPackage of [
        // ui-theme stays out: providing `theme` without a presenter would
        // promise repaints Amiba cannot deliver, and its host half taps the
        // served index to write a boot palette that fights Amiba's own.
        "@deepseek-ai/dsh-client-ui-theme",
      ]) {
        assert.ok(
          !ids.has(replacedClientPackage),
          `${replacedClientPackage} still competes with Amiba-owned UI state`,
        );
      }
      // Deliberately PRESENT (renderless here, and every disabled row's
      // client half injects them — see the web bundle patch header):
      // `ui-settings` for `settingsScope`, `locale` for `locale` + the
      // framework `t` seat. Without them the auto-mounted directory-picker
      // browse client hangs the whole boot on chooser-less hosts.
      //
      // Also deliberately PRESENT since Phase 4.3 (completion), and for a
      // different reason — these two are wanted for their SERVICES, and Amiba
      // owns the driver that makes them honest:
      //   - `ui-input-trigger` provides `inputTriggers` (source registry +
      //     per-session controller). Amiba's composer drives
      //     track/onSpace/adjudicate/pick/dismiss/serializeReference and
      //     answers the four scoped `slash/input-*` bail events, so a
      //     plugin's `registerSource` is actually consulted.
      //   - `ui-commands` provides `commandUi` (the `/` catalog source over
      //     `remote.commands`, client contributions, the popupSelect shell).
      //     It hard-depends on `inputTriggers` (`inject[0]`; its constructor
      //     throws `ui-commands: slash service unavailable`), so the two rows
      //     are present or absent together.
      // Their overlay COMPONENTS are shadowed by amiba-ui-shell at the same
      // ids with `priority: -1` — the official pixels need `--dsw-*`, which
      // only the excluded `ui-theme` defines, and the popup's risk gate comes
      // from `ui-primitives`, whose CSS modules ship stubbed to `{}`.
      for (const requiredServiceProvider of [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-input-trigger",
        "@deepseek-ai/dsh-client-ui-commands",
      ]) {
        assert.ok(
          ids.has(requiredServiceProvider),
          `${requiredServiceProvider} must stay in the client graph: its service is injected by official client plugins`,
        );
      }
      const uiShell = graph.entries.find(
        (entry) => entry.id === "@amiba/dsh-plugin-ui-shell",
      );
      assert.deepEqual(uiShell.inject, ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes"]);
      const bundle = await fetch(new URL(uiShell.url, baseUrl), {
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(bundle.status, 200);
      assert.match(
        await bundle.text(),
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-ui-shell"/u,
      );
      const memoryClient = graph.entries.find(
        (entry) => entry.id === "@amiba/dsh-plugin-memory-memos",
      );
      assert.deepEqual(memoryClient.inject, [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes",
        "@amiba/dsh-plugin-ui-shell",
      ]);
      const memoryBundle = await fetch(new URL(memoryClient.url, baseUrl), {
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(memoryBundle.status, 200);
      assert.match(
        await memoryBundle.text(),
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-memory-memos"/u,
      );
      const webhookClient = graph.entries.find(
        (entry) => entry.id === "@amiba/dsh-plugin-connector-webhook",
      );
      assert.deepEqual(webhookClient.inject, [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes",
        "@amiba/dsh-plugin-ui-shell",
        "@amiba/dsh-plugin-connector-core",
      ]);
      const webhookBundle = await fetch(
        new URL(webhookClient.url, baseUrl),
        {
          signal: AbortSignal.timeout(35_000),
        },
      );
      assert.equal(webhookBundle.status, 200);
      assert.match(
        await webhookBundle.text(),
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-connector-webhook"/u,
      );
      for (const [id, inject] of [
        [
          "@amiba/dsh-plugin-background-jobs",
          ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes", "@amiba/dsh-plugin-ui-shell"],
        ],
        [
          "@amiba/dsh-plugin-catalog",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
        [
          "@amiba/dsh-plugin-skills",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
        [
          "@amiba/dsh-plugin-mcp-manager",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
        [
          "@amiba/dsh-plugin-pets",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
        [
          "@amiba/dsh-plugin-cron",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
        [
          "@amiba/dsh-plugin-runtime-inventory",
          [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-api-remotes",
            "@amiba/dsh-plugin-ui-shell",
          ],
        ],
      ]) {
        const entry = graph.entries.find((candidate) => candidate.id === id);
        assert.deepEqual(entry.inject, inject);
        const response = await fetch(new URL(entry.url, baseUrl), {
          signal: AbortSignal.timeout(35_000),
        });
        assert.equal(response.status, 200);
        const clientBundleSource = await response.text();
        const factoryParameter = /factory:\s*(?:\(([$\w]+)\)|([$\w]+))\s*=>/u.exec(clientBundleSource);
        assert.ok(factoryParameter, `${id} omitted its CJS factory parameter`);
        const requireName = (factoryParameter[1] ?? factoryParameter[2]).replaceAll("$", "\\$");
        const requests = new RegExp(`\\b${requireName}\\("(@amiba/[^"\\n]+)"\\)`, "gu");
        for (const [, request] of clientBundleSource.matchAll(requests)) {
          assert.ok(entry.external?.includes(request), `${id} requires ${request} without declaring its module arrival dependency`);
        }
        assert.match(
          clientBundleSource,
          new RegExp(
            `window\\.__ModuleLoader__\\.load\\(\\{id:"${id.replaceAll("/", "\\/")}"`,
            "u",
          ),
        );
        assert.doesNotMatch(
          clientBundleSource,
          /PlatformAdapter not initialized/u,
          `${id} bundled Amiba's host-only PlatformAdapter singleton`,
        );
      }
      const shellScript = /<script\b[^>]*type="module"[^>]*src="([^"]+)"/u.exec(
        html,
      )?.[1];
      assert.ok(shellScript, "DSH Web Shell omitted its compiled module entry");
      const shellAsset = await fetch(new URL(shellScript, baseUrl), {
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(shellAsset.status, 200);
    },
  );

  await check(
    "native session, preset, settings, model, and credential catalogs",
    async () => {
      const sessions = await rpc(baseUrl, "session.list");
      assert.ok(Array.isArray(sessions.items));

      const presets = await rpc(baseUrl, "agentPreset.list");
      assert.ok(Array.isArray(presets.presets) && presets.presets.length > 0);
      assert.equal(presets.authorable, true);
      preset =
        presets.presets.find((item) => item.isDefault && !item.broken) ??
        presets.presets.find((item) => !item.broken);
      assert.ok(preset?.id, "DSH did not expose a usable Agent preset");

      const sourcePreset = await rpc(baseUrl, "agentPreset.read", {
        agentPreset: preset.id,
      });
      assert.equal(sourcePreset.agentPreset, preset.id);
      const copiedPresetId = "amiba-smoke-preset";
      const copied = await rpc(baseUrl, "agentPreset.copy", {
        from: preset.id,
        agentPreset: copiedPresetId,
        name: "Amiba smoke preset",
      });
      assert.equal(copied.agentPreset, copiedPresetId);
      const copiedPreset = await rpc(baseUrl, "agentPreset.read", {
        agentPreset: copiedPresetId,
      });
      assert.equal(copiedPreset.trust, "user");

      settings = await rpc(baseUrl, "settings.describe");
      assert.equal(settings.writable, true);
      assert.ok(settings.namespaces.some((item) => item.ns === "permission"));
      const presetSettings = settings.namespaces.find(
        (item) => item.ns === "agent-presets",
      );
      assert.ok(presetSettings, "agent-presets settings namespace is missing");
      const changedDefault = await rpc(baseUrl, "settings.update", {
        ns: "agent-presets",
        patch: { default: copiedPresetId },
        expectedRevision: presetSettings.revision,
      });
      assert.equal(changedDefault.value.default, copiedPresetId);
      const restoredDefault = await rpc(baseUrl, "settings.update", {
        ns: "agent-presets",
        patch: { default: preset.id },
        expectedRevision: changedDefault.revision,
      });
      assert.equal(restoredDefault.value.default, preset.id);
      await rpc(baseUrl, "agentPreset.remove", { agentPreset: copiedPresetId });
      const afterRemove = await rpc(baseUrl, "agentPreset.list");
      assert.ok(
        !afterRemove.presets.some((item) => item.id === copiedPresetId),
      );

      const providers = await rpc(baseUrl, "llm.providers");
      assert.ok(
        Array.isArray(providers.providers) && providers.providers.length > 0,
      );
      const models = await rpc(baseUrl, "llm.models");
      assert.ok(Array.isArray(models.groups));
      assert.ok(Array.isArray(models.failures));

      const ref = "AMIBA_DSH_SMOKE_SECRET";
      const before = await rpc(baseUrl, "credentials.describe", {
        refs: [ref],
      });
      assert.equal(before.credentials[ref].writable, true);
      await rpc(baseUrl, "credentials.set", {
        ref,
        value: `smoke-${randomUUID()}`,
      });
      const configured = await rpc(baseUrl, "credentials.describe", {
        refs: [ref],
      });
      assert.equal(configured.credentials[ref].configured, true);
      await rpc(baseUrl, "credentials.unset", { ref });
      const cleared = await rpc(baseUrl, "credentials.describe", {
        refs: [ref],
      });
      assert.equal(cleared.credentials[ref].configured, false);
    },
  );

  await check("workspace and live-session lifecycle", async () => {
    const createdWorkspace = await rpc(baseUrl, "workspace.create", {
      path: workspacePath,
    });
    workspace = createdWorkspace.workspace;
    assert.equal(await realpath(workspace.path), await realpath(workspacePath));
    const renamed = await rpc(baseUrl, "workspace.rename", {
      workspaceId: workspace.workspaceId,
      title: "DSH smoke workspace",
    });
    assert.equal(renamed.workspace.title, "DSH smoke workspace");
    const order = await rpc(baseUrl, "workspace.insertBefore", {
      workspaceId: workspace.workspaceId,
    });
    assert.ok(order.workspaceIds.includes(workspace.workspaceId));

    const createdSession = await rpc(baseUrl, "session.create", {
      workspaceId: workspace.workspaceId,
      agentPreset: preset.id,
    });
    sessionId = createdSession.sessionId;
    assert.ok(sessionId);
    const selected = await rpc(baseUrl, "agentPreset.select", {
      sessionId,
      agentPreset: preset.id,
    });
    assert.equal(selected.agentPreset, preset.id);
    await rpc(baseUrl, "session.rename", {
      sessionId,
      title: "DSH smoke session",
    });
    const listed = await rpc(baseUrl, "session.list");
    assert.ok(listed.items.some((item) => item.sessionId === sessionId));
    const moved = await rpc(baseUrl, "workspace.insertSessionBefore", {
      workspaceId: workspace.workspaceId,
      sessionId,
    });
    assert.ok(moved.workspace.sessionIds.includes(sessionId));
    const searched = await rpc(baseUrl, "session.search", {
      query: "DSH smoke",
    });
    assert.ok(Array.isArray(searched.items));
    const history = await rpc(baseUrl, "session.history", {
      sessionId,
      maxMessages: 20,
    });
    assert.ok(Array.isArray(history.events));
    let execution, completion;
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await rpc(baseUrl, "session.history", { sessionId, maxMessages: 50 });
      execution = snapshot.events.map(entry => entry.event ?? entry).find(event => event.type === "amiba/smoke/background");
      completion = snapshot.events.map(entry => entry.event ?? entry).find(event => event.type === "amiba/notice");
      if (execution && completion) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(execution, "native asynchronous producer did not finish the execution lifecycle");
    assert.ok(completion, "external job did not publish a durable presentation notice");
    assert.equal(completion.data.version, 1);
    assert.equal(completion.data.reference.kind, "background-job");
    assert.equal(completion.data.reference.sessionId, sessionId);
    assert.match(completion.data.reference.id, /^[a-f0-9-]{36}$/);
    assert.match(completion.data.reference.instance, /^\d+$/);
    assert.ok(!execution.data.error, execution.data.error);
    assert.equal(execution.data.running, "running");
    assert.equal(execution.data.status, "completed");
    assert.match(execution.data.output, /fixture.txt/);
    assert.ok(!JSON.stringify(completion.data).includes("PRIVATE_TOKEN"));
    assert.ok(
      history.projections?.values?.permissions,
      "permission projection is missing",
    );
  });

  await check("official WebSocket event downlink", async () => {
    await waitForMuxSubscription(baseUrl, sessionId);
  });

  await check(
    "session-scoped commands, skills, models, and tools",
    async () => {
      const skills = await rpc(baseUrl, "skill.list", { sessionId });
      assert.ok(Array.isArray(skills.skills));

      const smokeSkillName = "amiba-smoke-skill";
      const smokeSkillRoot = path.join(dshHome, "skills", smokeSkillName);
      await mkdir(smokeSkillRoot, { recursive: true });
      await writeFile(
        path.join(smokeSkillRoot, "SKILL.md"),
        `---\nname: ${smokeSkillName}\ndescription: Verify live DSH skill discovery.\nuser-invocable: true\ndisable-model-invocation: false\n---\n\n# Smoke\n\nReturn the integration marker.\n`,
        { mode: 0o600 },
      );
      await waitFor("new DSH skill", async () => {
        const current = await rpc(baseUrl, "skill.list", { sessionId });
        return current.skills.some((skill) => skill.name === smokeSkillName);
      });
      await rm(smokeSkillRoot, { recursive: true, force: false });
      await waitFor("removed DSH skill", async () => {
        const current = await rpc(baseUrl, "skill.list", { sessionId });
        return !current.skills.some((skill) => skill.name === smokeSkillName);
      });

      const sessionModels = await rpc(baseUrl, "session.models", { sessionId });
      assert.ok(sessionModels.current?.provider);

      const unauthorized = await pluginRequest(baseUrl, "/api/amiba/tools", {
        authorized: false,
        expectedStatus: 401,
      });
      assert.equal(unauthorized.error, "unauthorized");

      const globalTools = await pluginRequest(baseUrl, "/api/amiba/tools");
      assert.ok(Array.isArray(globalTools.value.tools));
      const scopedTools = await pluginRequest(
        baseUrl,
        `/api/amiba/tools?sessionId=${encodeURIComponent(sessionId)}`,
      );
      // The product catalog is the union of standing preset scopes and global
      // contributions. It must not vary with the currently viewed session.
      assert.deepEqual(scopedTools.value, globalTools.value);
      assert.equal(new Set(globalTools.value.tools.map(tool => tool.id)).size, globalTools.value.tools.length);
      const sourceCounts = scopedTools.value.tools.reduce((counts, tool) => {
        counts[tool.source.distribution] = (counts[tool.source.distribution] ?? 0) + 1;
        return counts;
      }, {});
      assert.ok(sourceCounts.builtin > 0);
      assert.ok(scopedTools.value.tools.every(tool => ["builtin", "user"].includes(tool.source.distribution)));
      const amibaToolPackages = [
        ...new Set(
          scopedTools.value.tools
            .filter((tool) => tool.source.kind === "dsh-plugin")
            .map((tool) => tool.source.packageName),
        ),
      ].sort();
      for (const packageName of [
        "@amiba/dsh-plugin-attachments",
        "@amiba/dsh-plugin-browser-core",
        "@amiba/dsh-plugin-memory-memos",
        "@amiba/dsh-plugin-resources",
        "@amiba/dsh-plugin-pets",
      ]) assert.ok(amibaToolPackages.includes(packageName), `tool catalog omitted ${packageName}`);
      assert.ok(
        scopedTools.value.tools.every((tool) =>
          ["dsh-core", "dsh-plugin", "mcp-server"].includes(tool.source.kind),
        ),
        "tool inventory contains a non-DSH ownership category",
      );
      const petLibrary = await rpc(baseUrl, "amibaPets/list", { args: {} });
      assert.equal(petLibrary.version, 1);
      assert.ok(Array.isArray(petLibrary.pets));
      const savedPets = await rpc(baseUrl, "amibaPets/save", {
        args: { input: { name: "Remote lifecycle pet", skinId: "mofli-dough" } },
      });
      const savedPet = savedPets.pets.find(pet => pet.name === "Remote lifecycle pet");
      assert.ok(savedPet, "pet save Remote did not persist its record");
      const remainingPets = await rpc(baseUrl, "amibaPets/deletePet", { args: { id: savedPet.id } });
      assert.equal(remainingPets.pets.length, petLibrary.pets.length);
      assert.ok(!remainingPets.pets.some(pet => pet.id === savedPet.id));
      const toolNames = new Set(
        scopedTools.value.tools.map((tool) => tool.name),
      );
      for (const required of [
        "memos_search",
        "memos_get",
        "memos_timeline",
        "memos_environment",
        "memos_skill_list",
        "memos_skill_get",
        "cron_create",
        "cron_list",
        "cron_delete",
        "pets_catalog", "pets_list", "pets_save", "pets_activate", "pets_delete",
        "amiba_resource_search",
        "amiba_resource_read",
      ]) {
        assert.ok(toolNames.has(required), `runtime tool catalog is missing ${required}`);
      }
      for (const retired of ["memory_list", "memory_store", "memory_forget"]) {
        assert.ok(!toolNames.has(retired), `retired memory tool is still active: ${retired}`);
      }
      const memory = await rpc(baseUrl, "amibaMemory/status", { args: {} });
      assert.equal(memory.state, "ready");
      assert.equal(memory.mode, "full");
      assert.equal(memory.engine, "memos");
      assert.equal(memory.viewerUrl, `http://127.0.0.1:${memoryViewerPort}`);
      const health = await (await fetch(`${memory.viewerUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      })).json();
      assert.equal(health.ok, true);
      assert.equal(await realpath(health.paths.home), await realpath(memory.home));

      const commands = await pluginRequest(
        baseUrl,
        `/api/amiba/commands?sessionId=${encodeURIComponent(sessionId)}`,
      );
      assert.ok(
        commands.value.some((command) => command.name === "permission"),
      );
      const projection = (
        await rpc(baseUrl, "session.history", {
          sessionId,
          maxMessages: 1,
        })
      ).projections.values.permissions;
      const response = await pluginRequest(baseUrl, "/api/amiba/commands", {
        method: "POST",
        body: {
          sessionId,
          line: `/permission ${projection.currentValue}`,
        },
      });
      assert.equal(
        response.value.result.kind,
        "success",
        response.value.result.text,
      );
      const cancelled = await rpc(baseUrl, "session.cancel", { sessionId });
      assert.equal(cancelled.accepted, true);
    },
  );

  await check("background jobs presentation plugin and session fence", async () => {
    const inventory = await rpc(baseUrl, "pluginInventory/list", { args: {} });
    const entry = inventory.entries.find(entry => entry.moduleName === "@amiba/dsh-plugin-background-jobs");
    assert.ok(entry, "background jobs plugin missing from bundle");
    assert.equal(entry.fiberPhase, "active");
    await assert.rejects(() => rpc(baseUrl, "amibaJobs/inspect", {
      args: { sessionId: "nonexistent-jobs-smoke-session", id: "bash-1" },
    }), /not found|unknown|no such|does not exist/i);
  });

  await check("MemOS-only memory status and removed archive surfaces", async () => {
    const status = await rpc(baseUrl, "amibaMemory/status", { args: {} });
    assert.equal(status.engine, "memos");
    assert.equal(status.state, "ready");
    assert.equal(status.mode, "full");
    for (const method of ["list", "presets", "reset"]) {
      await assert.rejects(
        () => rpc(baseUrl, `amibaMemory/${method}`, { args: { preset: "standard", target: "all" } }),
        /not.found|unknown|HTTP 404/iu,
      );
    }
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${baseUrl}/api/amiba/memory`, {
        method,
        headers: { "x-amiba-plugin-token": pluginToken, "content-type": "application/json" },
        ...(method === "DELETE" ? { body: JSON.stringify({ preset: "standard", target: "all" }) } : {}),
      });
      assert.equal(response.status, 404, "retired memory HTTP API must not be mounted");
    }
    for (const file of ["memory-store.js", "memory-store.d.ts", "http.js", "http.d.ts", "client/toolviews.js", "client/toolviews.d.ts"]) {
      assert.equal(existsSync(path.join(runtimeDir, "app/node_modules/@amiba/dsh-plugin-memory-memos/lib", file)), false, `orphaned archive artifact: ${file}`);
    }
    assert.equal(existsSync(path.join(dshHome, "amiba-memory")), false);
  });

  await check(
    "Commands plugin exposes the scoped DSH catalog as a Remote",
    async () => {
      const commands = await rpc(baseUrl, "amibaCommands/list", {
        args: { sessionId },
      });
      assert.ok(Array.isArray(commands));
      assert.ok(commands.every((command) => typeof command.name === "string"));
    },
  );

  await check("Usage plugin reads canonical DSH session logs", async () => {
    const usage = await rpc(baseUrl, "amibaUsage/list", { args: {} });
    assert.ok(Array.isArray(usage.records));
    assert.ok(Array.isArray(usage.failures));
  });

  await check(
    "Model Plane is shared by headless, Web, and Electron clients",
    async () => {
      const directory = await rpc(baseUrl, "llm.providers");
      const catalog = await rpc(baseUrl, "llm.models");
      const settings = await rpc(baseUrl, "settings.describe");
      const tokenDance = directory.providers.find(p => p.provider === "tokendance");
      assert.ok(tokenDance, "TokenDance must appear through the official directory");
      assert.equal(tokenDance.settingsNs, "llm-tokendance");
      assert.equal(directory.providers.filter(p => p.provider.startsWith("tokendance")).length, 1);
      assert.equal(tokenDance.active, false);
      assert.ok(!catalog.groups.some(g => g.id === "tokendance"));
      const tokenSettings = settings.namespaces.find(n => n.ns === "llm-tokendance");
      assert.deepEqual(tokenSettings.value.providers, {});
      const configuredToken = await rpc(baseUrl, "settings.mutate", {
        ns: tokenSettings.ns, expectedRevision: tokenSettings.revision,
        ops: [{op: "set", path: ["providers", "tokendance"], value: {refreshCatalog: false}}],
      });
      const configuredDirectory = await rpc(baseUrl, "llm.providers");
      assert.equal(configuredDirectory.providers.find(p => p.provider === "tokendance").active, true);
      assert.ok(directory.providers.some(p => p.provider === "deepseek-official"));

      const prefs = settings.namespaces.find(n => n.ns === "amiba-model-ui");
      assert.ok(prefs, "optional UI preferences use the official settings seam");
      const changed = await rpc(baseUrl, "settings.mutate", {
        ns: prefs.ns, expectedRevision: prefs.revision,
        ops: [{op: "set", path: ["hiddenProviders"], value: ["tokendance"]}],
      });
      const afterHide = await rpc(baseUrl, "llm.models");
      assert.ok(afterHide.groups.some(g => g.id === "tokendance"), "UI preferences must not change official model capabilities");
      await rpc(baseUrl, "settings.mutate", {ns: prefs.ns, expectedRevision: changed.revision, ops: [{op: "unset", path: ["hiddenProviders"]}]});
      await rpc(baseUrl, "settings.mutate", {ns: tokenSettings.ns, expectedRevision: configuredToken.revision, ops: [{op: "unset", path: ["providers", "tokendance"]}]});
      assert.equal((await rpc(baseUrl, "llm.providers")).providers.find(p => p.provider === "tokendance").active, false);
    },
  );

  await check("account-bound resource plugin and denied identity routing", async () => {
    const inventory = await pluginRequest(baseUrl, "/api/amiba/tools");
    for (const name of ["amiba_resource_search", "amiba_resource_read"]) assert.ok(inventory.value.tools.some((tool) => tool.name === name && tool.source.packageName === "@amiba/dsh-plugin-resources"), `${name} is missing or has the wrong owner`);
    const result = await rpc(baseUrl, "amibaResources/search", { args: { input: { query: "smoke", source: "lark", connectionId: "nonexistent-smoke-account" } } });
    assert.deepEqual(result.items, []);
    assert.equal(result.unavailable[0]?.connectionId, "nonexistent-smoke-account");
    await assert.rejects(() => rpc(baseUrl, "amibaResources/read", { args: { ref: { source: "lark", connectionId: "nonexistent-smoke-account", identity: "nobody", kind: "contact", id: "person" } } }));
    await assert.rejects(() => rpc(baseUrl, "amibaLarkPersonal/manage", { args: { input: { action: "status", connectionId: "nonexistent-smoke-account" } } }), /connection_unavailable/);
  });

  await check("connector-owned Webhook lifecycle and private settings", async () => {
    const availablePresets = await rpc(baseUrl, "agentPreset.list");
    const connectionPreset = availablePresets.presets.find((item) => item.isDefault && !item.broken)
      ?? availablePresets.presets.find((item) => !item.broken);
    assert.ok(connectionPreset?.id, "A connection needs a usable agent preset");
    const providers = await rpc(baseUrl, "amibaConnectors/listProviders", { args: {} });
    assert.ok(providers.providers.some((provider) => provider.id === "webhook"));
    const token = "smoke-test-credential-" + randomBytes(24).toString("hex");
    const created = await rpc(baseUrl, "amibaConnectors/createConnect", { args: { input: {
      provider: "webhook", name: "DSH smoke webhook", agentPreset: connectionPreset.id,
      config: { token, allowedSenders: ["smoke"] },
    } } });
    try {
      assert.equal(created.status.state, "ready");
      assert.equal(created.channelId, undefined);
      const endpoint = new URL("/api/amiba/connectors/webhook/" + created.id, baseUrl);
      const send = (credential, sender) => fetch(endpoint, {
        method: "POST",
        headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
        body: JSON.stringify({ id: "smoke-rejected", text: "must not reach the Agent", sender }),
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal((await send("invalid", "smoke")).status, 401);
      assert.equal((await send(token, "stranger")).status, 403);
      const updated = await rpc(baseUrl, "amibaConnectors/updateConnect", { args: {
        id: created.id, input: { name: "DSH smoke updated", settings: { token: token + "-rotated" } },
      } });
      assert.equal(updated.name, "DSH smoke updated");
      assert.equal((await send(token, "smoke")).status, 401);
      const details = await rpc(baseUrl, "amibaConnectors/getConnectDetails", { args: { id: created.id } });
      assert.deepEqual(details.settings.allowedSenders, ["smoke"]);
      assert.ok(details.messaging);
      assert.ok(!JSON.stringify(details).includes(token));
      await rpc(baseUrl, "amibaConnectors/setEnabled", { args: { id: created.id, enabled: false } });
      assert.equal((await send(token + "-rotated", "smoke")).status, 404);
    } finally {
      const removed = await rpc(baseUrl, "amibaConnectors/removeConnect", { args: { id: created.id } });
      assert.equal(removed.deleted, true);
    }
  });

  await check(
    "Skills Typert Remote owns user authoring over ctx.skills",
    async () => {
      const initial = await rpc(baseUrl, "amibaSkills/list", {
        args: { sessionId: null },
      });
      assert.ok(Array.isArray(initial.skills));
      assert.equal(initial.userRoot, path.join(dshHome, "skills"));
      const document = [
        "---",
        "name: smoke-skill",
        'description: "Smoke-test user skill."',
        "user-invocable: true",
        "disable-model-invocation: false",
        "---",
        "",
        "# Smoke skill",
        "",
        "Use only for runtime smoke validation.",
        "",
      ].join("\n");
      const saved = await rpc(baseUrl, "amibaSkills/save", {
        args: { name: "smoke-skill", document, sessionId },
      });
      assert.equal(saved.name, "smoke-skill");
      const read = await rpc(baseUrl, "amibaSkills/read", {
        args: { name: "smoke-skill", sessionId },
      });
      assert.equal(read.document, document);
      assert.equal(read.source, "user-dsh");
      assert.equal(read.editable, true);
      const files = await rpc(baseUrl, "amibaSkills/listFiles", {
        args: { name: "smoke-skill", sessionId },
      });
      assert.ok(files.files.some((file) => file.path === "SKILL.md"));
      const file = await rpc(baseUrl, "amibaSkills/readFile", {
        args: { name: "smoke-skill", path: "SKILL.md", sessionId },
      });
      assert.equal(file.encoding, "utf-8");
      assert.equal(file.content, document);
      const removed = await rpc(baseUrl, "amibaSkills/removeSkill", {
        args: { name: "smoke-skill", sessionId },
      });
      assert.equal(removed.deleted, true);
    },
  );

  await check(
    "MCP Typert Remote manages official DSH MCP child plugins",
    async () => {
      const initial = await rpc(baseUrl, "amibaMcp/list", { args: {} });
      assert.deepEqual(initial, { servers: [], toolsOnly: true, dependencies: [] });
      const access = await rpc(baseUrl, "amibaMcp/listAccess", { args: {} });
      assert.deepEqual(access, []);
      const saved = await rpc(baseUrl, "amibaMcp/save", {
        args: {
          input: {
            serverName: "smoke-http",
            transport: "streamable-http",
            enabled: false,
            url: "https://mcp.example.test/endpoint",
            headers: { authorization: "Bearer smoke" },
          },
        },
      });
      assert.equal(saved.server.serverName, "smoke-http");
      assert.deepEqual(saved.server.headerKeys, ["authorization"]);
      const listed = await rpc(baseUrl, "amibaMcp/list", { args: {} });
      assert.equal(listed.servers.length, 1);
      const removed = await rpc(baseUrl, "amibaMcp/removeServer", {
        args: { serverName: "smoke-http" },
      });
      assert.equal(removed.deleted, true);
    },
  );

  await check("official MCP client supervisor reload", async () => {
    const unauthorized = await pluginRequest(baseUrl, "/api/amiba/mcp/reload", {
      method: "POST",
      authorized: false,
      body: { servers: [] },
      expectedStatus: 401,
    });
    assert.equal(unauthorized.error, "unauthorized");
    const reloaded = await pluginRequest(baseUrl, "/api/amiba/mcp/reload", {
      method: "POST",
      body: { servers: [] },
    });
    assert.ok(Number.isInteger(reloaded.generation));
    assert.deepEqual(reloaded.configured, []);
  });

  await check("media generation tools and durable artifacts", async () => {
    const html = await (await fetch(new URL("/", baseUrl))).text();
    const boot = /<script>(?:window\.__DSH_BOOT__|globalThis\[\s*["']__DSH_BOOT__["']\s*\])\s*=\s*([\s\S]*?)<\/script>/u.exec(html);
    assert.ok(boot?.[1]);
    const graph = JSON.parse(boot[1]);
    const client = graph.entries.find(entry => entry.id === "@amiba/dsh-plugin-media");
    assert.ok(client, "Media client missing from packaged graph");
    assert.deepEqual(client.inject, ["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-api-remotes","@amiba/dsh-plugin-ui-shell"]);
    const bundle = await fetch(new URL(client.url,baseUrl));
    assert.equal(bundle.status,200);
    const source = await bundle.text();
    assert.ok(source.includes("amiba.models.extension") && source.includes("media_generate") && source.includes("amibaMediaUi"), "Media client lacks settings, toolview or RPC contribution");

    const created = await rpc(baseUrl, "workspace.create", { path: workspacePath });
    const session = await rpc(baseUrl, "session.create", {workspaceId: created.workspace.workspaceId, agentPreset: "standard"});
    let completed;
    await waitFor("media fixture completion", async () => {
      const history = await rpc(baseUrl, "session.history", {sessionId:session.sessionId,maxMessages:100});
      completed = history.events.map(row => row.event ?? row).find(row => row.type === "amiba/smoke/media");
      return !!completed;
    }, 20000);
    assert.ok(!completed.data.error, completed.data.error);
    const record = completed.data.record;
    assert.equal(record.status, "succeeded");
    assert.equal(record.artifacts.length, 1);
    const persisted = await rpc(baseUrl, "amibaMediaUi/inspect", {args:{sessionId:session.sessionId,recordId:record.id}});
    assert.equal(persisted.status, "succeeded");
    const chunk = await rpc(baseUrl, "amibaMediaUi/artifact", {args:{sessionId:session.sessionId,recordId:record.id,artifactId:record.artifacts[0].id,offset:0}});
    assert.equal(chunk.mimeType, "image/png");
    assert.equal(chunk.nextOffset, null);
    assert.equal(Buffer.from(chunk.data,"base64").subarray(1,4).toString(), "PNG");
    await assert.rejects(() => rpc(baseUrl, "amibaMediaUi/inspect", {args:{sessionId:"wrong-session",recordId:record.id}}));
    for (const enabled of [false, true]) {
      const catalog = JSON.parse(await rpc(baseUrl, "amibaMediaUi/catalog", {args:{}}));
      await rpc(baseUrl, "amibaMediaUi/setModelEnabled", {args:{provider:record.provider,model:record.model,enabled,revision:catalog.revision}});
      const next = await rpc(baseUrl, "session.create", {workspaceId:created.workspace.workspaceId,agentPreset:"standard"});
      let result;
      await waitFor("media model switch enforcement", async () => {
        const history = await rpc(baseUrl, "session.history", {sessionId:next.sessionId,maxMessages:100});
        result = history.events.map(row => row.event ?? row).find(row => row.type === "amiba/smoke/media");
        return !!result;
      }, 20000);
      if (enabled) assert.equal(result.data.record?.status, "succeeded");
      else assert.match(result.data.error ?? "", /disabled/i);
    }
    const holdMs = Math.min(120000, Math.max(0, Number(process.env.AMIBA_DSH_SMOKE_UI_HOLD_MS) || 0));
    if (holdMs) { process.stdout.write(`[dsh:smoke] media UI inspection window ${holdMs}ms at ${baseUrl}\n`); await new Promise(resolve => setTimeout(resolve, holdMs)); }
  });

  await check("background jobs durable host restart", async () => {
    const created = await rpc(baseUrl, "workspace.create", { path: workspacePath });
    const session = await rpc(baseUrl, "session.create", {workspaceId: created.workspace.workspaceId, agentPreset: "standard"});
    let record;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await rpc(baseUrl, "amibaJobs/relations", {args: {sessionId: session.sessionId}});
      record = rows.find(row => row.title === "Smoke download" && row.status === "completed" && row.resultCallIds?.length);
      if (record) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(record, "background result record was not saved");
    const history = await rpc(baseUrl, "session.history", {sessionId:session.sessionId,maxMessages:50});
    const execution = history.events.map(entry=>entry.event ?? entry).find(event=>event.type === "amiba/smoke/background");
    assert.ok(execution, "native async producer did not finish");
    assert.ok(!execution.data.error, execution.data.error);
    assert.equal(execution.data.running,"running");
    assert.equal(execution.data.status,"completed");
    assert.match(execution.data.output,/fixture.txt/);
    const before = await rpc(baseUrl, "amibaJobs/inspect", {args: {sessionId: session.sessionId, id: record.recordId}});
    assert.match(before.output, /fixture.txt/);
    const persisted = (await rpc(baseUrl, "amibaJobs/relations", {args: {sessionId: session.sessionId}})).find(row => row.recordId === record.recordId);
    await stopChild();
    output = "";
    child = startServer();
    baseUrl = await waitForReady();
    // Do not reopen/resume an Agent: cold history must be independently queryable.
    const after = await rpc(baseUrl, "amibaJobs/inspect", {args: {sessionId: session.sessionId, id: record.recordId}});
    assert.equal(after.output, before.output);
    assert.equal(after.title, before.title);
    assert.equal(after.callId, before.callId);
    assert.equal(after.liveOutput, false);
    const rows = await rpc(baseUrl, "amibaJobs/relations", {args: {sessionId: session.sessionId}});
    assert.deepEqual(rows.find(row => row.recordId === record.recordId), persisted);
    await rpc(baseUrl, "session.history", {sessionId: session.sessionId, maxMessages: 50});
  });

  await check("archive and workspace cleanup", async () => {
    const archived = await rpc(baseUrl, "workspace.archiveSession", {
      sessionId,
    });
    assert.ok(archived.archivedSessionIds.includes(sessionId));
    await rpc(baseUrl, "workspace.delete", {
      workspaceId: workspace.workspaceId,
    });
    const listed = await rpc(baseUrl, "workspace.list");
    assert.ok(
      !listed.items.some((item) => item.workspaceId === workspace.workspaceId),
    );
  });

  await check(
    "external bundle is live in the official Loader inventory",
    async () => {
      const inventory = await rpc(baseUrl, "pluginInventory/list", {
        args: {},
      });
      const externalEntry = inventory.entries.find(
        (entry) => entry.moduleName === externalPackageName,
      );
      assert.ok(
        externalEntry,
        `Loader inventory omitted ${externalPackageName}: ${JSON.stringify(inventory.entries)}`,
      );
      assert.equal(externalEntry.entryId, "include:amiba-smoke-external");
      assert.equal(externalEntry.enabled, true);
      assert.equal(externalEntry.fiberPhase, "active");
    },
  );

  await stopChild();
  await check("official DSH profile plugin removal", async () => {
    await runProcess(
      runtimeNode,
      [
        entrypoint,
        "plugin",
        "--profile",
        profileName,
        "remove",
        "-w",
        externalPackageName,
      ],
      { env: managedCommandEnv() },
    );
    const manifest = JSON.parse(
      await readFile(path.join(profileDir, "package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies?.[externalPackageName], undefined);
    assert.ok(!manifest.dsh.profile.bundles.includes(externalPackageName));
  });

  assert.ok(selectedChecks > 0, `No checks matched ${checkFilter}`);
  process.stdout.write(checkFilter
    ? `[dsh:smoke] ${selectedChecks} selected integration check(s) passed (${checkFilter})\n`
    : "[dsh:smoke] all managed-runtime integration checks passed\n");
} catch (error) {
  process.stderr.write(
    `[dsh:smoke] failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  if (output)
    process.stderr.write(`\n[dsh:smoke] runtime output tail:\n${output}\n`);
  process.exitCode = 1;
} finally {
  await stopChild().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
