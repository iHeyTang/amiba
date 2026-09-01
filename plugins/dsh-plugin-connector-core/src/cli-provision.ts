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

/**
 * Applier-derived per-connect identity for a "cli" capability provision —
 * owned entirely by the "cli" applier (`index.ts`'s `connectInstanceKey`),
 * never by the provider-declared `CliProvisionSpec`. Threaded through so
 * `provisionCli` can namespace every per-connect filesystem artifact it
 * writes — the wrapper script and the carrier skill directory — and can put
 * a human-readable identity into the carrier skill's `SKILL.md`.
 */
export interface CliProvisionInstance {
  /** Per-connect namespacing key, e.g. `lark-3f9a1b2c` (see
   * `connectInstanceKey` in `index.ts`). Two connects of the same provider
   * always share the exact same `spec.id` — it's a PROVIDER constant (lark's
   * cli capability always declares the literal `"lark"`) — so without this,
   * both connects would provision their wrapper AND carrier skill to the
   * identical path: the second connect's provision would silently overwrite
   * the first's already-credentialed wrapper, and disposing either connect
   * would delete the artifact the other one still depends on. */
  id: string;
  /** The connect's own user-facing name (`StoredConnect.name`) — embedded
   * into the carrier skill's `SKILL.md` so a session reading it can tell
   * which connect this CLI belongs to. */
  connectName: string;
  /** The provider id (`StoredConnect.provider`, e.g. `"lark"`) — embedded
   * alongside `connectName` for the same reason. */
  provider: string;
}

export interface CliProvisionHandle {
  binaryPath: string;
  wrapperPath: string;
  /** Absolute path to the carrier skill's `SKILL.md` (see
   * `seedCarrierSkill` below) — seeded so a session can discover and invoke
   * the wrapper without any provider-specific tool wiring. */
  skillPath: string;
  seededSkills: string[];
  /** Removes the wrapper script AND the carrier skill directory — both are
   * this instance's own applier-owned artifacts, fully derived and safe to
   * regenerate. The shared managed install and any curated package skills
   * (`seededSkills`) are left in place (they're user-space/shared-cache now).
   * Idempotent. */
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
 *
 * Path is keyed by `instance.id`, NOT `spec.id`: `spec.id` is a shared
 * provider constant, so keying on it would collide two connects of the same
 * provider onto the identical wrapper file (see `CliProvisionInstance`'s
 * doc comment).
 */
async function writeWrapper(
  spec: CliProvisionSpec,
  instance: CliProvisionInstance,
  binaryPath: string,
  deps: CliProvisionDeps,
): Promise<string> {
  const wrappersDir = join(deps.cliRoot, "wrappers");
  await deps.mkdir(wrappersDir, { recursive: true, mode: 0o700 });
  const wrapperPath = join(wrappersDir, `${instance.id}.sh`);

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

/**
 * Renders the carrier skill's `SKILL.md` body — see `seedCarrierSkill`
 * below for why this exists. Frontmatter follows the shipped DSH skills'
 * convention (`@deepseek-ai/dsh-skill`'s loader requires at minimum a `name`
 * matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` and a `description`; both are
 * satisfied here since `instance.id` is already produced by
 * `connectInstanceKey`'s slugify step — see its doc comment in `index.ts`).
 *
 * Every value embedded is non-secret: the wrapper's absolute path, the
 * connect's display name/provider, and the spec's package/binary identity.
 * `spec.env`'s actual VALUES — the credentials — are never referenced here;
 * only `wrapperPath` is, and the wrapper script itself (not this document)
 * is what carries those credentials into the CLI's environment. Body is
 * bilingual (zh-CN + English), matching this repo's existing i18n habit for
 * user-facing copy.
 */
function renderCarrierSkill(
  spec: CliProvisionSpec,
  instance: CliProvisionInstance,
  wrapperPath: string,
): string {
  return [
    "---",
    `name: ${instance.id}`,
    `description: Invoke the "${spec.binary}" CLI (package ${spec.package}) provisioned for the "${instance.connectName}" connect (provider: ${instance.provider}); credentials are pre-wired, never pass secrets on argv.`,
    "---",
    "",
    `# ${spec.binary} — ${instance.connectName}`,
    "",
    `本技能封装了为连接 "${instance.connectName}"（provider: \`${instance.provider}\`）预先配置好的官方 CLI \`${spec.binary}\`（包名 \`${spec.package}\`）。凭据已经通过环境变量预置进下面的 wrapper 脚本，永远不要在命令行参数（argv）中传递任何密钥。`,
    `This skill wraps the official \`${spec.binary}\` CLI (package \`${spec.package}\`), pre-provisioned with credentials for the "${instance.connectName}" connect (provider: \`${instance.provider}\`). Credentials are already wired into the wrapper's environment below — never pass secrets on the command line.`,
    "",
    "## 如何调用 / How to invoke",
    "",
    "从 bash 直接执行 wrapper 的绝对路径，并在其后跟上子命令：",
    "Invoke the wrapper's absolute path directly from bash, followed by a subcommand:",
    "",
    "```bash",
    `"${wrapperPath}" <subcommand> [args...]`,
    "```",
    "",
    "## 发现可用命令 / Discover available commands",
    "",
    "```bash",
    `"${wrapperPath}" --help`,
    "```",
    "",
    "## 安全须知 / Security",
    "",
    "- 凭据已经预置在 wrapper 脚本内部；切勿在命令行参数（argv）中传递任何 token 或密钥。",
    "- Credentials are already pre-wired inside the wrapper script; never pass any token or secret on argv.",
    "",
  ].join("\n");
}

/**
 * Seeds the ONE first-party "carrier" skill that makes the wrapper
 * discoverable at all. Unlike `seedSkills` above (curated, create-only,
 * user-owned copies of a package's own skills), this skill is
 * APPLIER-OWNED: its content is fully derived from `spec`/`instance`/
 * `wrapperPath`, so — exactly like the wrapper script itself — it is
 * written unconditionally on every provision (overwrite, never skip), and
 * `provisionCli`'s dispose() removes it alongside the wrapper (see below).
 * Written to `<skillsRoot>/<instance.id>/SKILL.md`, namespaced by the same
 * per-connect `instance.id` as the wrapper for the same collision reason.
 */
async function seedCarrierSkill(
  spec: CliProvisionSpec,
  instance: CliProvisionInstance,
  wrapperPath: string,
  deps: CliProvisionDeps,
): Promise<string> {
  const skillDir = join(deps.skillsRoot, instance.id);
  await deps.mkdir(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  await deps.writeFile(skillPath, renderCarrierSkill(spec, instance, wrapperPath));
  return skillPath;
}

export async function provisionCli(
  spec: CliProvisionSpec,
  instance: CliProvisionInstance,
  deps: CliProvisionDeps,
): Promise<CliProvisionHandle> {
  const binaryPath = await resolveBinaryPath(spec, deps);
  const wrapperPath = await writeWrapper(spec, instance, binaryPath, deps);
  // Curated skills, sourced from the provider's own installed package
  // (`spec.skills`, create-only under `<skillsRoot>/<name>/`, shared across
  // every connect/instance of this provider — see `seedSkills` above).
  // Honesty note: for today's only real "cli" provider, `@larksuite/cli`'s
  // published npm package ships NO `skills/` directory at all (confirmed at
  // implementation time — see the M2b plan's task-2 progress note), so this
  // call is currently a guaranteed no-op for lark's provision: it warns
  // once and seeds nothing. The carrier skill seeded right below is what
  // actually makes the wrapper discoverable today; this curated path stays
  // wired for whenever a CLI package starts shipping its own skills/ (or a
  // future provider's package already does).
  const seededSkills = await seedSkills(spec, binaryPath, deps);
  const skillPath = await seedCarrierSkill(spec, instance, wrapperPath, deps);

  let disposed = false;
  return {
    binaryPath,
    wrapperPath,
    skillPath,
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
      // connector's wrapper failing to delete. Swallow and warn instead —
      // independently for the wrapper and the carrier skill, so a failure
      // removing one never blocks the attempt to remove the other.
      try {
        await deps.rm(wrapperPath, { force: true });
        deps.log.info?.(
          `cli "${spec.id}" [${instance.id}]: removed wrapper script — managed install and seeded skills left in place`,
        );
      } catch (error) {
        deps.log.warn(
          `cli "${spec.id}" [${instance.id}]: failed to remove wrapper script at ${wrapperPath} — ${String(error)}`,
        );
      }
      try {
        await deps.rm(join(deps.skillsRoot, instance.id), { force: true, recursive: true });
        deps.log.info?.(
          `cli "${spec.id}" [${instance.id}]: removed carrier skill — curated package skills left in place`,
        );
      } catch (error) {
        deps.log.warn(
          `cli "${spec.id}" [${instance.id}]: failed to remove carrier skill at ${join(deps.skillsRoot, instance.id)} — ${String(error)}`,
        );
      }
    },
  };
}
