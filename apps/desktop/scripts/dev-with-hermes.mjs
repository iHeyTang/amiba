import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.resolve(desktopDir, "../../../hermes-agent");
const source = path.resolve(process.env.AMIBA_HERMES_DEV_SOURCE ?? defaultSource);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(pnpm, ["dev"], {
  cwd: desktopDir,
  env: { ...process.env, AMIBA_HERMES_DEV_SOURCE: source },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[hermes:dev] could not start desktop: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
