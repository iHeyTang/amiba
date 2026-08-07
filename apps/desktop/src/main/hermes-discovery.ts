/**
 * Hermes executable discovery for the Electron main process.
 *
 * Finder/login-item launches on macOS do not inherit the user's interactive
 * shell PATH. Keep discovery independent of that launch detail and validate a
 * candidate with the local-only `--help` command: `--version` performs an
 * update check in older Hermes releases and can block on the network during
 * startup, which must never turn an installed runtime into "not installed".
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface HermesDiscoveryResult {
  installed: boolean;
  /** Absolute path of the validated executable. */
  binary?: string;
  /** Optional for compatibility with the renderer's existing contract. */
  version?: string;
}

export interface QuickRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function appendPathEntry(
  entries: string[],
  seen: Set<string>,
  entry: string | undefined,
  platform: NodeJS.Platform,
): void {
  if (!entry) return;
  const normalized = path.normalize(entry.trim());
  if (!normalized) return;
  const key = platform === "win32" ? normalized.toLowerCase() : normalized;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(normalized);
}

/**
 * Build the deterministic environment used for every Hermes-owned child.
 *
 * This is deliberately program-owned instead of relying on `.zshrc`: GUI apps
 * do not consistently load shell startup files after login/reboot. Existing
 * process PATH entries are retained, while Hermes-managed and standard package
 * manager locations are made available on every launch.
 */
export function buildHermesRuntimeEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  userHome = os.homedir(),
  extraPathEntries: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...sourceEnv };
  if (platform === "win32") env.USERPROFILE ||= userHome;
  else env.HOME ||= userHome;

  const hermesHome =
    sourceEnv.HERMES_HOME && path.isAbsolute(sourceEnv.HERMES_HOME)
      ? sourceEnv.HERMES_HOME
      : path.join(userHome, ".hermes");
  const delimiter = platform === "win32" ? ";" : ":";
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const entry of extraPathEntries) {
    appendPathEntry(entries, seen, entry, platform);
  }

  if (platform === "win32") {
    appendPathEntry(entries, seen, path.join(hermesHome, "bin"), platform);
    appendPathEntry(entries, seen, path.join(hermesHome, "node"), platform);
    appendPathEntry(
      entries,
      seen,
      sourceEnv.LOCALAPPDATA
        ? path.join(sourceEnv.LOCALAPPDATA, "Microsoft", "WinGet", "Links")
        : undefined,
      platform,
    );
  } else {
    appendPathEntry(
      entries,
      seen,
      path.join(userHome, ".local", "bin"),
      platform,
    );
    appendPathEntry(
      entries,
      seen,
      path.join(userHome, ".cargo", "bin"),
      platform,
    );
    appendPathEntry(entries, seen, path.join(hermesHome, "bin"), platform);
    appendPathEntry(
      entries,
      seen,
      path.join(hermesHome, "node", "bin"),
      platform,
    );
    appendPathEntry(entries, seen, "/opt/homebrew/bin", platform);
    appendPathEntry(entries, seen, "/usr/local/bin", platform);
  }

  for (const entry of (sourceEnv.PATH ?? "").split(delimiter)) {
    appendPathEntry(entries, seen, entry, platform);
  }

  if (platform !== "win32") {
    for (const entry of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      appendPathEntry(entries, seen, entry, platform);
    }
  }
  env.PATH = entries.join(delimiter);
  return env;
}

/** Run a bounded child process using the same normalized runtime environment. */
export async function runQuiet(
  cmd: string,
  args: string[],
  timeoutMs = 5000,
  env: NodeJS.ProcessEnv = buildHermesRuntimeEnv(),
): Promise<QuickRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child: ChildProcess;
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<QuickRunResult, "timedOut">) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, timedOut });
    };

    try {
      child = spawn(cmd, args, { shell: false, env });
    } catch (err) {
      finish({
        code: null,
        stdout: "",
        stderr: String((err as Error).message),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        finish({ code: null, stdout, stderr });
      }
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (data: string) => {
      stdout += data;
    });
    child.stderr?.on("data", (data: string) => {
      stderr += data;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ code: null, stdout, stderr: stderr + String(err.message) });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr });
    });
  });
}

export async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a bare executable name using the normalized GUI-safe PATH. */
export async function resolveOnPath(
  name: string,
  env: NodeJS.ProcessEnv = buildHermesRuntimeEnv(),
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const finder = platform === "win32" ? "where" : "which";
  const result = await runQuiet(finder, [name], 4000, env);
  if (result.code !== 0) return null;
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && path.isAbsolute(first) ? first : null;
}

/** Resolve installer-created symlinks before looking for sibling commands. */
export async function resolveExecutableTarget(
  executable: string,
  env: NodeJS.ProcessEnv = buildHermesRuntimeEnv(),
): Promise<string> {
  let resolved = executable;
  if (!path.isAbsolute(resolved)) {
    resolved = (await resolveOnPath(resolved, env)) ?? resolved;
  }
  if (!path.isAbsolute(resolved)) return resolved;
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

interface CandidateOptions {
  cachedBinary?: string | null;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  platform?: NodeJS.Platform;
}

/** The single ordered discovery ladder used at startup and on manual recheck. */
export function hermesBinaryCandidates({
  cachedBinary,
  env = process.env,
  userHome = os.homedir(),
  platform = process.platform,
}: CandidateOptions = {}): string[] {
  const hermesHome =
    env.HERMES_HOME && path.isAbsolute(env.HERMES_HOME)
      ? env.HERMES_HOME
      : path.join(userHome, ".hermes");
  const installDir =
    env.HERMES_INSTALL_DIR && path.isAbsolute(env.HERMES_INSTALL_DIR)
      ? env.HERMES_INSTALL_DIR
      : path.join(hermesHome, "hermes-agent");
  const candidates =
    platform === "win32"
      ? [
          cachedBinary,
          "hermes.exe",
          "hermes.cmd",
          env.LOCALAPPDATA
            ? path.join(env.LOCALAPPDATA, "hermes", "bin", "hermes.exe")
            : null,
          path.join(installDir, "venv", "Scripts", "hermes.exe"),
        ]
      : [
          cachedBinary,
          "hermes",
          path.join(userHome, ".local", "bin", "hermes"),
          path.join(userHome, ".cargo", "bin", "hermes"),
          path.join(installDir, "venv", "bin", "hermes"),
          "/opt/homebrew/bin/hermes",
          "/usr/local/bin/hermes",
        ];
  return [...new Set(candidates.filter((value): value is string => !!value))];
}

interface DiscoverOptions extends CandidateOptions {
  /** Restrict discovery to an explicit ordered ladder (managed runtimes use this). */
  candidates?: readonly string[];
  timeoutMs?: number;
}

export async function discoverHermes({
  cachedBinary,
  candidates,
  env = process.env,
  userHome = os.homedir(),
  platform = process.platform,
  timeoutMs = 5000,
}: DiscoverOptions = {}): Promise<HermesDiscoveryResult> {
  const runtimeEnv = buildHermesRuntimeEnv(env, userHome, [], platform);
  const candidateList = candidates ??
    hermesBinaryCandidates({ cachedBinary, env, userHome, platform });
  for (const candidate of candidateList) {
    const isAbsolute = path.isAbsolute(candidate);
    if (isAbsolute && !(await fileExists(candidate))) continue;

    // Do not use `--version` here. Hermes <=0.19 performs a synchronous git
    // update check for that flag and can exceed this timeout while the network
    // is coming up after login. `--help` validates the CLI without networking.
    const result = await runQuiet(candidate, ["--help"], timeoutMs, runtimeEnv);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 || !/Hermes Agent/i.test(output)) continue;

    const binary = isAbsolute
      ? candidate
      : await resolveOnPath(candidate, runtimeEnv, platform);
    if (!binary || !path.isAbsolute(binary)) continue;
    return { installed: true, binary };
  }
  return { installed: false };
}
