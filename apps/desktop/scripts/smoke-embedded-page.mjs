import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const tooling = createRequire(require.resolve("electron-vite"));
const { build } = tooling("esbuild");
const root = await mkdtemp(path.join(tmpdir(), "amiba-native-page-"));
try {
  const outfile = path.join(root, "main.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("./fixtures/embedded-page-smoke.ts", import.meta.url))],
    outfile, bundle: true, platform: "node", format: "esm", external: ["electron"], target: "node22" });
  const env = { ...process.env, AMIBA_PAGE_SMOKE_HOME: path.join(root, "profile") };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [outfile], { env, stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
  const code = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
  clearTimeout(timer);
  process.exitCode = code;
} finally { await rm(root, { recursive: true, force: true }); }
