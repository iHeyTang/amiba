import { execFile } from "node:child_process";
import {
  chmod as fsChmod,
  cp,
  mkdir as fsMkdir,
  readFile,
  realpath,
  rm as fsRm,
  stat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { Context } from "@deepseek-ai/cordis";

import type { CliProvisionDeps } from "./cli-provision.js";
import type { Config } from "./index.js";

const execFileAsync = promisify(execFile);

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** PATH lookup for `pkgBinary` — the spec's declared executable name
 * (`spec.binary`), NOT the (possibly scoped) package name — followed by
 * `--version` to read back whatever version string it reports. Anything
 * that fails along the way (not on PATH, not executable, no parseable
 * version) is treated as "no usable existing install" rather than an
 * error. */
async function resolveExisting(
  pkgBinary: string,
): Promise<{ path: string; version: string } | null> {
  const lookup = process.platform === "win32" ? "where" : "which";
  let binaryPath: string;
  try {
    const { stdout } = await execFileAsync(lookup, [pkgBinary]);
    binaryPath = stdout.split(/\r?\n/u)[0]?.trim() ?? "";
    if (!binaryPath) return null;
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"]);
    const match = /(\d+\.\d+\.\d+)/u.exec(stdout);
    if (!match) return null;
    return { path: binaryPath, version: match[1]! };
  } catch {
    return null;
  }
}

function binNameFor(pkg: string): string {
  const segments = pkg.split("/");
  return segments[segments.length - 1] ?? pkg;
}

/** Reads back the binary a managed install of `pkg` produced under `dir`.
 * `binary` — the spec's declared executable name — is tried first at its
 * expected `node_modules/.bin/<binary>` location; a scoped package's
 * `package.json#bin` is consulted only as a fallback, in case what actually
 * got installed doesn't match what the spec declared. `null` when neither
 * resolves to something on disk. */
async function resolveInstalledBinary(
  dir: string,
  pkg: string,
  binary: string,
): Promise<string | null> {
  const preferred = join(dir, "node_modules", ".bin", binary);
  if (await pathExists(preferred)) return preferred;

  const pkgRoot = join(dir, "node_modules", pkg);
  try {
    const raw = await readFile(join(pkgRoot, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as { bin?: string | Record<string, string> };
    let binName: string | undefined;
    if (manifest.bin && typeof manifest.bin === "object") {
      const [first] = Object.keys(manifest.bin);
      binName = first;
    } else if (typeof manifest.bin === "string") {
      binName = binNameFor(pkg);
    }
    if (!binName) return null;
    const fallback = join(dir, "node_modules", ".bin", binName);
    return (await pathExists(fallback)) ? fallback : null;
  } catch {
    return null;
  }
}

/** Installs `pkg@version` into the shared cache directory `dir`, skipping
 * the actual `npm install` when `binary` is already resolvable there. */
async function managedInstall(
  pkg: string,
  version: string,
  dir: string,
  binary: string,
): Promise<string> {
  const existing = await resolveInstalledBinary(dir, pkg, binary);
  if (existing) return existing;

  await fsMkdir(dir, { recursive: true });
  await execFileAsync("npm", [
    "install",
    "--prefix",
    dir,
    "--no-save",
    "--no-audit",
    "--no-fund",
    `${pkg}@${version}`,
  ]);

  const installed = await resolveInstalledBinary(dir, pkg, binary);
  if (!installed)
    throw new Error(`managed install of "${pkg}@${version}" produced no resolvable binary`);
  return installed;
}

/** Create-only directory copy: a no-op (returns `false`) when `dst` already
 * exists; otherwise copies `src` recursively into `dst`. Rejects when `src`
 * is missing or not a directory — callers treat that as "skip, warn". */
async function copyDirIfAbsent(src: string, dst: string): Promise<boolean> {
  if (await pathExists(dst)) return false;
  const source = await stat(src); // throws ENOENT when src is missing
  if (!source.isDirectory()) throw new Error(`source is not a directory: ${src}`);
  await fsMkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true });
  return true;
}

/** Walks up from `binaryPath` (resolved through any symlinks, e.g. an npm
 * `node_modules/.bin` shim) looking for the installed package root — a
 * `package.json` whose `name` matches `pkg` — then returns its `skills`
 * subdirectory if one exists. `null` when no matching package root, or no
 * `skills` directory under it, is found within a bounded walk. */
async function findPackageSkillsDir(pkg: string, binaryPath: string): Promise<string | null> {
  let dir: string;
  try {
    dir = dirname(await realpath(binaryPath));
  } catch {
    dir = dirname(binaryPath);
  }

  for (let depth = 0; depth < 8; depth++) {
    const manifestPath = join(dir, "package.json");
    if (await pathExists(manifestPath)) {
      try {
        const raw = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as { name?: string };
        if (manifest.name === pkg) {
          const skillsDir = join(dir, "skills");
          return (await pathExists(skillsDir)) ? skillsDir : null;
        }
      } catch {
        // Malformed package.json at this level — keep walking up rather
        // than failing the whole lookup over one unreadable manifest.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Production `CliProvisionDeps`: real PATH lookups, a real (shared-cache)
 * `npm install` via `child_process`, and real filesystem calls. Never used
 * by `cli-provision.test.ts` — that suite only ever drives `provisionCli`
 * through a fully faked `CliProvisionDeps`. */
export function realCliDeps(ctx: Context, config: Config): CliProvisionDeps {
  const log = ctx.logger("amiba-connector-core");
  return {
    cliRoot: config.cliRoot,
    skillsRoot: config.skillsRoot,
    resolveExisting,
    managedInstall,
    writeFile: (path, content) => fsWriteFile(path, content, "utf8"),
    chmod: (path, mode) => fsChmod(path, mode),
    mkdir: async (path, options) => {
      await fsMkdir(path, options);
    },
    rm: (path, options) => fsRm(path, options),
    copyDirIfAbsent,
    findPackageSkillsDir,
    log: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
    },
  };
}
