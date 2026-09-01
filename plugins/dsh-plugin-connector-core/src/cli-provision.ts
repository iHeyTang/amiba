import { join } from "node:path";

import type { CliProvisionSpec } from "./types.js";

/**
 * Every side effect `provisionCli` performs, seamed for tests. Production
 * wiring (`realCliDeps` in index.ts) backs this with PATH lookups, a
 * `child_process` npm install, and real filesystem calls; tests supply a
 * fake that only ever records calls — no process is ever spawned, no file
 * ever touches disk, from `cli-provision.test.ts`.
 */
export interface CliProvisionDeps {
  /** Root the managed install cache and wrapper scripts live under
   * (`<cliRoot>/<package>@<version>/`, `<cliRoot>/wrappers/`). */
  cliRoot: string;
  /** Root skills are seeded into (`<skillsRoot>/<name>/`). */
  skillsRoot: string;
  /** PATH lookup for `spec.binary` — the CLI's actual executable name, NOT
   * `spec.package` (a scoped package name like `@larksuite/cli` can never
   * be found on PATH or under `node_modules/.bin/` directly). Returns
   * `null` when nothing is found; the caller decides whether a found
   * version meets `minVersion`. */
  resolveExisting(pkgBinary: string): Promise<{ path: string; version: string } | null>;
  /** Installs `pkg@version` into `dir` (a shared cache directory) if not
   * already present there, and returns the resulting `binary`'s path. */
  managedInstall(pkg: string, version: string, dir: string, binary: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  /** Copies `src` into `dst` only when `dst` doesn't exist yet (create-only);
   * returns whether a copy happened. Rejects when `src` is missing or
   * otherwise unusable — callers treat that as "skip this one, warn". */
  copyDirIfAbsent(src: string, dst: string): Promise<boolean>;
  /** Locates the skills directory shipped inside an installed/found copy of
   * `pkg` (given its resolved binary path), or `null` if none can be found. */
  findPackageSkillsDir(pkg: string, binaryPath: string): Promise<string | null>;
  log: { info?(msg: string): void; warn(msg: string): void };
}

export interface CliProvisionHandle {
  binaryPath: string;
  wrapperPath: string;
  seededSkills: string[];
  /** Removes the wrapper script only — the shared managed install and any
   * seeded skills are left in place (they're user-space now). Idempotent. */
  dispose(): Promise<void>;
}

/** Best-effort `major.minor.patch` extraction — tolerant of a leading `v`,
 * build metadata, and pre-release suffixes; anything unparseable sorts as
 * `0.0.0` rather than throwing, since this only ever gates a soft "below
 * minVersion, fall through to managed install" decision. */
function parseVersionTriplet(input: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(input.trim());
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `actual` is greater than or equal to `min`, compared as plain
 * `major.minor.patch` triplets (pre-release/build metadata ignored). */
function versionMeets(actual: string, min: string): boolean {
  const [actualMajor, actualMinor, actualPatch] = parseVersionTriplet(actual);
  const [minMajor, minMinor, minPatch] = parseVersionTriplet(min);
  if (actualMajor !== minMajor) return actualMajor > minMajor;
  if (actualMinor !== minMinor) return actualMinor > minMinor;
  return actualPatch >= minPatch;
}

/** Single-quote shell escaping: wraps in `'...'`, and every embedded `'` is
 * closed, escaped, and reopened as `'\''` — safe for arbitrary values,
 * including ones containing spaces, quotes, or shell metacharacters. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

/**
 * Resolution order (v1): an existing install on PATH meeting `minVersion`
 * wins outright — no managed install is attempted. A PATH hit below
 * `minVersion` is treated as absent (with a warning) rather than used, and
 * falls through to a managed install of `pinnedVersion` into the shared
 * `<cliRoot>/<package>@<version>/` cache.
 */
async function resolveBinaryPath(
  spec: CliProvisionSpec,
  deps: CliProvisionDeps,
): Promise<string> {
  const existing = await deps.resolveExisting(spec.binary);
  if (existing) {
    if (versionMeets(existing.version, spec.minVersion)) return existing.path;
    deps.log.warn(
      `cli "${spec.id}": found ${spec.binary}@${existing.version} on PATH, ` +
        `below required ${spec.minVersion} — treating as absent and using a managed install`,
    );
  }
  const installDir = join(deps.cliRoot, `${spec.package}@${spec.pinnedVersion}`);
  return deps.managedInstall(spec.package, spec.pinnedVersion, installDir, spec.binary);
}

/**
 * Writes (or overwrites) the wrapper script every provision — its content is
 * fully derived from `spec` and `binaryPath`, so regenerating unconditionally
 * is safe and keeps a stale wrapper from ever surviving a spec change.
 * Written 0600 under a 0700 parent, since `spec.env` can carry secrets that
 * must never be readable by anyone but the owning user.
 */
async function writeWrapper(
  spec: CliProvisionSpec,
  binaryPath: string,
  deps: CliProvisionDeps,
): Promise<string> {
  const wrappersDir = join(deps.cliRoot, "wrappers");
  await deps.mkdir(wrappersDir, { recursive: true, mode: 0o700 });
  const wrapperPath = join(wrappersDir, `${spec.id}.sh`);

  const lines = ["#!/bin/sh"];
  for (const [key, value] of Object.entries(spec.env)) {
    lines.push(`export ${key}=${shellEscape(value)}`);
  }
  lines.push(`exec "${binaryPath}" "$@"`);

  await deps.writeFile(wrapperPath, lines.join("\n") + "\n");
  await deps.chmod(wrapperPath, 0o600);
  return wrapperPath;
}

/**
 * Create-only skill seeding: never fails the provision. A missing package
 * skills directory (nothing found for `spec.package`) skips every requested
 * skill with one warning; a per-skill copy failure (missing source,
 * unreadable, wrong shape, ...) skips just that skill with its own warning.
 * Skills already present at `<skillsRoot>/<name>/` (from a previous
 * provision, or hand-edited by the user) are left untouched and are not
 * counted as newly seeded.
 */
async function seedSkills(
  spec: CliProvisionSpec,
  binaryPath: string,
  deps: CliProvisionDeps,
): Promise<string[]> {
  if (spec.skills.length === 0) return [];

  const packageSkillsDir = await deps.findPackageSkillsDir(spec.package, binaryPath);
  if (!packageSkillsDir) {
    deps.log.warn(
      `cli "${spec.id}": could not locate a skills directory for package ` +
        `"${spec.package}" — skipping ${spec.skills.length} skill(s)`,
    );
    return [];
  }

  const seeded: string[] = [];
  for (const name of spec.skills) {
    const src = join(packageSkillsDir, name);
    const dst = join(deps.skillsRoot, name);
    try {
      const copied = await deps.copyDirIfAbsent(src, dst);
      if (copied) seeded.push(name);
    } catch (error) {
      deps.log.warn(
        `cli "${spec.id}": failed to seed skill "${name}" — ${String(error)}`,
      );
    }
  }
  return seeded;
}

export async function provisionCli(
  spec: CliProvisionSpec,
  deps: CliProvisionDeps,
): Promise<CliProvisionHandle> {
  const binaryPath = await resolveBinaryPath(spec, deps);
  const wrapperPath = await writeWrapper(spec, binaryPath, deps);
  const seededSkills = await seedSkills(spec, binaryPath, deps);

  let disposed = false;
  return {
    binaryPath,
    wrapperPath,
    seededSkills,
    async dispose() {
      if (disposed) return;
      disposed = true;
      // Best-effort unwind: the caller (index.ts's "cli" applier disposer)
      // fires this via `void handle.dispose()` — fire-and-forget, same as
      // every other capability disposer (see center.ts's own best-effort
      // unwind around its disposers). A rejection here would surface as an
      // unhandled promise rejection with no catcher anywhere up the chain,
      // which can crash the whole DSH runtime process over a single
      // connector's wrapper failing to delete. Swallow and warn instead.
      try {
        await deps.rm(wrapperPath, { force: true });
        deps.log.info?.(
          `cli "${spec.id}": removed wrapper script — managed install and seeded skills left in place`,
        );
      } catch (error) {
        deps.log.warn(
          `cli "${spec.id}": failed to remove wrapper script at ${wrapperPath} — ${String(error)}`,
        );
      }
    },
  };
}
