/**
 * BUNDLE-COMPOSITION integration check (documented ruling).
 *
 * This script black-box smoke-tests the shipped `dsh-bundle-amiba-core`
 * composition end-to-end. It therefore MAY reference plugin package names
 * and drive their public RPC surfaces (e.g. `amibaMemory/list`) — that is
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

async function check(name, callback) {
  await callback();
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
      'export const name = "amiba-smoke-external";\nexport const inject = [];\nexport function apply() {}\n',
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

  child = spawn(
    runtimeNode,
    [entrypoint, "--profile", profileName, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        AMIBA_DSH_API_TOKEN: pluginToken,
        AMIBA_RUNTIME_GATEWAY_URL: "http://127.0.0.1:9",
        AMIBA_RUNTIME_GATEWAY_TOKEN: pluginToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const baseUrl = await waitForReady();
  process.stdout.write(`[dsh:smoke] running isolated DSH at ${baseUrl}\n`);

  let preset;
  let settings;
  let workspace;
  let sessionId;
  let channel;

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
          /<script>window\.__DSH_BOOT__\s*=\s*([\s\S]*?)<\/script>/u.exec(html);
        assert.ok(manifestMatch?.[1], "DSH Web Shell omitted __DSH_BOOT__");
        graph = JSON.parse(manifestMatch[1]);
        ids = new Set(graph.entries.map((entry) => entry.id));
        if (
          ids.has("@amiba/dsh-plugin-catalog") &&
          ids.has("@amiba/dsh-plugin-memory") &&
          ids.has("@amiba/dsh-plugin-messaging-core") &&
          ids.has("@amiba/dsh-plugin-skills") &&
          ids.has("@amiba/dsh-plugin-mcp-manager") &&
          ids.has("@amiba/dsh-plugin-runtime-inventory") &&
          ids.has(externalPackageName) &&
          ids.has("@amiba/dsh-plugin-schedule-adapter")
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
        ids.has("@amiba/dsh-plugin-memory"),
        `DSH client graph omitted Memory's Client contribution: ${[...ids].join(", ")}`,
      );
      assert.ok(
        ids.has("@amiba/dsh-plugin-messaging-core"),
        `DSH client graph omitted messaging-core's Client contribution: ${[...ids].join(", ")}`,
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
        ids.has("@amiba/dsh-plugin-schedule-adapter"),
        `DSH client graph omitted Schedule's workspace contribution: ${[...ids].join(", ")}`,
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
      assert.deepEqual(uiShell.inject, ["@deepseek-ai/dsh-client-runtime"]);
      const bundle = await fetch(new URL(uiShell.url, baseUrl), {
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(bundle.status, 200);
      assert.match(
        await bundle.text(),
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-ui-shell"/u,
      );
      const memoryClient = graph.entries.find(
        (entry) => entry.id === "@amiba/dsh-plugin-memory",
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
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-memory"/u,
      );
      const messagingClient = graph.entries.find(
        (entry) => entry.id === "@amiba/dsh-plugin-messaging-core",
      );
      assert.deepEqual(messagingClient.inject, [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes",
        "@amiba/dsh-plugin-ui-shell",
      ]);
      const messagingBundle = await fetch(
        new URL(messagingClient.url, baseUrl),
        {
          signal: AbortSignal.timeout(35_000),
        },
      );
      assert.equal(messagingBundle.status, 200);
      assert.match(
        await messagingBundle.text(),
        /window\.__ModuleLoader__\.load\(\{id:"@amiba\/dsh-plugin-messaging-core"/u,
      );
      for (const [id, inject] of [
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
            "@amiba/dsh-plugin-catalog",
          ],
        ],
        [
          "@amiba/dsh-plugin-schedule-adapter",
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
      assert.equal(globalTools.value.scope, "global");
      const scopedTools = await pluginRequest(
        baseUrl,
        `/api/amiba/tools?sessionId=${encodeURIComponent(sessionId)}`,
      );
      assert.equal(scopedTools.value.scope, "session");
      assert.equal(scopedTools.value.exact, true);
      assert.equal(scopedTools.value.tools.length, 41);
      const sourceCounts = scopedTools.value.tools.reduce((counts, tool) => {
        counts[tool.source.kind] = (counts[tool.source.kind] ?? 0) + 1;
        return counts;
      }, {});
      assert.deepEqual(sourceCounts, { "dsh-core": 28, "dsh-plugin": 13 });
      const amibaToolPackages = [
        ...new Set(
          scopedTools.value.tools
            .filter((tool) => tool.source.kind === "dsh-plugin")
            .map((tool) => tool.source.packageName),
        ),
      ].sort();
      assert.deepEqual(amibaToolPackages, [
        "@amiba/dsh-plugin-attachments",
        "@amiba/dsh-plugin-browser-core",
        "@amiba/dsh-plugin-memory",
      ]);
      assert.ok(
        scopedTools.value.tools.every((tool) =>
          ["dsh-core", "dsh-plugin", "mcp-server"].includes(tool.source.kind),
        ),
        "tool inventory contains a non-DSH ownership category",
      );
      const toolNames = new Set(
        scopedTools.value.tools.map((tool) => tool.name),
      );
      for (const required of [
        "memory_list",
        "memory_store",
        "memory_forget",
        "schedule_create",
        "schedule_list",
        "schedule_delete",
      ]) {
        assert.ok(toolNames.has(required), `live Agent is missing ${required}`);
      }

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

  await check("DSH schedule persistence and management bridge", async () => {
    const created = await pluginRequest(baseUrl, "/api/amiba/schedules", {
      method: "POST",
      body: {
        sessionId,
        prompt: "Amiba DSH smoke reminder",
        afterSeconds: 86_400,
      },
    });
    assert.ok(created.value?.id);
    const listed = await pluginRequest(
      baseUrl,
      `/api/amiba/schedules?sessionId=${encodeURIComponent(sessionId)}`,
    );
    assert.ok(listed.value.some((item) => item.id === created.value.id));
    const removed = await pluginRequest(baseUrl, "/api/amiba/schedules", {
      method: "DELETE",
      body: { sessionId, id: created.value.id },
    });
    assert.equal(removed.value.deleted, true);
  });

  await check("plugin-owned memory management bridge", async () => {
    const listed = await pluginRequest(
      baseUrl,
      "/api/amiba/memory?preset=standard",
    );
    assert.equal(listed.value.preset, "standard");
    assert.ok(Array.isArray(listed.value.targets));
    const reset = await pluginRequest(baseUrl, "/api/amiba/memory", {
      method: "DELETE",
      body: { preset: "standard", target: "all" },
    });
    assert.ok(Array.isArray(reset.value.deletedIds));
  });

  await check("DSH Typert Remote for Memory's Client plugin", async () => {
    const snapshot = await rpc(baseUrl, "amibaMemory/list", {
      args: { preset: "standard" },
    });
    assert.equal(snapshot.preset, "standard");
    assert.deepEqual(
      snapshot.targets.map((target) => target.target),
      ["memory", "user"],
    );
    const reset = await rpc(baseUrl, "amibaMemory/reset", {
      args: { preset: "standard", target: "all" },
    });
    assert.ok(Array.isArray(reset.deletedIds));
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
      const plane = await rpc(baseUrl, "amibaModelPlane/snapshot", {
        args: {},
      });
      assert.equal(typeof plane.revision, "number");
      assert.ok(Array.isArray(plane.providers));
      assert.ok(Array.isArray(plane.groups));
      assert.ok(
        plane.providers.some(
          (provider) => provider.id === "deepseek-official",
        ),
      );
    },
  );

  await check(
    "messaging-core Typert Remote and channel lifecycle",
    async () => {
      const initial = await rpc(baseUrl, "amibaMessaging/list", { args: {} });
      assert.ok(
        initial.providers.some((provider) => provider.id === "webhook"),
      );
      assert.match(initial.inboundEndpoint, /\/api\/amiba\/message-inbound$/u);
      const created = await rpc(baseUrl, "amibaMessaging/create", {
        args: {
          input: {
            provider: "webhook",
            name: "DSH smoke channel",
            sessionId,
            allowedSenders: ["smoke"],
          },
        },
      });
      channel = created;
      assert.match(channel.secret, /^amiba_/u);
      assert.equal(channel.channel.sessionId, sessionId);
      const rejected = await fetch(
        new URL("/api/amiba/message-inbound", baseUrl),
        {
          method: "POST",
          headers: {
            authorization: "Bearer invalid",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            channelId: channel.channel.id,
            id: "smoke-rejected",
            text: "must not reach the Agent",
            sender: "smoke",
          }),
          signal: AbortSignal.timeout(35_000),
        },
      );
      assert.equal(rejected.status, 401);
      const updated = await rpc(baseUrl, "amibaMessaging/update", {
        args: {
          id: channel.channel.id,
          patch: { name: "DSH smoke channel updated", enabled: false },
        },
      });
      assert.equal(updated.name, "DSH smoke channel updated");
      assert.equal(updated.enabled, false);
      const rotated = await rpc(baseUrl, "amibaMessaging/rotate", {
        args: { id: channel.channel.id },
      });
      assert.match(rotated.secret, /^amiba_/u);
      const removed = await rpc(baseUrl, "amibaMessaging/removeChannel", {
        args: { id: channel.channel.id },
      });
      assert.equal(removed.deleted, true);
    },
  );

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
      assert.deepEqual(initial, { servers: [], toolsOnly: true });
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

  process.stdout.write(
    "[dsh:smoke] all managed-runtime integration checks passed\n",
  );
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
