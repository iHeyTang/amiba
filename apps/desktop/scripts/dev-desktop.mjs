import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  HERMES_LOCAL_MODE,
  loadDesktopLocalConfig,
} from "./desktop-local-config.mjs";

const desktopDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(desktopDir, "../..");
const localConfigPath = path.join(repositoryRoot, ".amiba.local.ts");
const runtimeDir = path.join(desktopDir, "resources", "hermes-runtime");
const preparedSource = path.join(runtimeDir, "hermes-agent");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const infoOnly = process.argv.includes("--runtime-info");

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(
      `[desktop:dev] could not read ${label}: ${error.message}\n` +
        "[desktop:dev] Run: pnpm runtime:prepare",
    );
    process.exit(1);
  }
}

function shortRevision(value) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 12)
    : "unknown";
}

let localConfig;
try {
  localConfig = await loadDesktopLocalConfig(localConfigPath, repositoryRoot);
} catch (error) {
  console.error(`[desktop:dev] Invalid local config: ${error.message}`);
  process.exit(1);
}

const environmentSource = process.env.AMIBA_HERMES_DEV_SOURCE;
const configuredSource =
  localConfig.hermesMode === HERMES_LOCAL_MODE.DIRECT_SOURCE
    ? localConfig.hermesSource
    : undefined;
const source = path.resolve(
  environmentSource ?? configuredSource ?? preparedSource,
);
const directlyRunningSource = !!(environmentSource || configuredSource);

if (!fs.existsSync(path.join(source, "pyproject.toml"))) {
  if (directlyRunningSource) {
    console.error(
      `[desktop:dev] Configured Hermes source is invalid: ${source}\n` +
        `[desktop:dev] Check: ${localConfigPath}`,
    );
  } else {
    console.error(
      "[desktop:dev] Hermes Runtime is not prepared.\n" +
        "[desktop:dev] Run: pnpm runtime:prepare",
    );
  }
  process.exit(1);
}

const declaration = readJson(
  path.join(desktopDir, "hermes-runtime-manifest.json"),
  "Hermes Runtime declaration",
);
const marker = readJson(
  path.join(runtimeDir, "runtime-manifest.json"),
  "prepared Hermes Runtime marker",
);
const patches = Array.isArray(marker.appliedPatches)
  ? marker.appliedPatches
      .map((patch) => patch?.id)
      .filter((id) => typeof id === "string" && id.length > 0)
  : [];
const sourceOrigin = environmentSource
  ? "directly running source checkout (environment override)"
  : configuredSource
    ? "directly running source checkout (local config)"
    : marker.buildFlavor === "development"
      ? "local checkout snapshot (Amiba copy)"
      : "built-in Runtime (manifest-pinned)";

console.log(
  [
    `[desktop:dev] Amiba Desktop Runtime — ${sourceOrigin}`,
    `  Hermes     ${marker.hermesVersion ?? "unknown"} (${shortRevision(marker.hermesCommit)})`,
    `  Backplane  ${marker.backplaneVersion ?? "unknown"}`,
    `  Bundle     ${marker.buildFlavor ?? "unknown"} · ${marker.platform ?? "unknown"}-${marker.arch ?? "unknown"} · schema ${marker.schemaVersion ?? "unknown"}`,
    `  Toolchain  Python ${marker.pythonVersion ?? "unknown"} · Node ${marker.nodeVersion ?? "unknown"} · Playwright ${marker.playwrightVersion ?? "unknown"}`,
    `  Revision   ${shortRevision(marker.sourceRevision)}`,
    `  Patches    ${patches.length > 0 ? patches.join(", ") : "none"}`,
    `  Services   gateway 127.0.0.1:${declaration.gatewayPort ?? "unknown"} · backplane 127.0.0.1:${declaration.backplanePort ?? "unknown"}`,
    `  Built      ${marker.builtAt ?? "unknown"}`,
    `  Runtime    ${runtimeDir}`,
    `  Source     ${source}`,
  ].join("\n"),
);

if (infoOnly) process.exit(0);

const desktopEnv = { ...process.env };
if (directlyRunningSource) {
  desktopEnv.AMIBA_HERMES_DEV_SOURCE = source;
} else {
  // Built-in and prepared-snapshot modes are bundles, not source overrides.
  // Electron executes the selected bundle directly from app resources.
  delete desktopEnv.AMIBA_HERMES_DEV_SOURCE;
}

const child = spawn(pnpm, ["dev"], {
  cwd: desktopDir,
  env: desktopEnv,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[desktop:dev] could not start desktop: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
