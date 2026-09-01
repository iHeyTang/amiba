import { describe, expect, it, vi } from "vitest";

import { provisionCli, type CliProvisionDeps, type CliProvisionInstance } from "./cli-provision.js";
import type { CliProvisionSpec } from "./types.js";

// `binary` ("acme-cli") is deliberately NOT derivable from `package`
// ("@acme/cli") by any naive transform (stripping the scope gives "cli",
// not "acme-cli") — this is what real scoped CLI packages look like (e.g.
// `@larksuite/cli`'s actual binary is `lark-cli`), and it's what makes a
// regression that resolves/installs against `spec.package` instead of
// `spec.binary` visible in these tests instead of accidentally passing.
function fakeSpec(overrides: Partial<CliProvisionSpec> = {}): CliProvisionSpec {
  return {
    id: "acme-cli",
    package: "@acme/cli",
    binary: "acme-cli",
    minVersion: "1.2.0",
    pinnedVersion: "1.2.3",
    env: {},
    skills: [],
    ...overrides,
  };
}

// `id` ("acme-instance-a1b2c3d4") is deliberately NOT equal to `fakeSpec()`'s
// `id` ("acme-cli") — this is what the real "cli" applier produces (see
// `connectInstanceKey` in index.ts: it's derived from `spec.id` PLUS the
// connect id, never `spec.id` alone), and it's what makes a regression that
// keys the wrapper/carrier-skill path off `spec.id` instead of `instance.id`
// visible in these tests instead of accidentally passing.
function fakeInstance(overrides: Partial<CliProvisionInstance> = {}): CliProvisionInstance {
  return {
    id: "acme-instance-a1b2c3d4",
    connectName: "My Acme Connect",
    provider: "acme",
    ...overrides,
  };
}

/**
 * A fake `CliProvisionDeps` that records every call instead of touching a
 * process or the filesystem. Every method has a sane no-op-ish default so a
 * test only needs to override the handful of calls it actually cares about.
 */
function fakeDeps(overrides: Partial<CliProvisionDeps> = {}) {
  const calls = {
    resolveExisting: [] as string[],
    managedInstall: [] as Array<{ pkg: string; version: string; dir: string; binary: string }>,
    writeFile: [] as Array<{ path: string; content: string }>,
    chmod: [] as Array<{ path: string; mode: number }>,
    mkdir: [] as Array<{ path: string; options?: { recursive?: boolean; mode?: number } }>,
    rm: [] as Array<{ path: string; options?: { force?: boolean; recursive?: boolean } }>,
    copyDirIfAbsent: [] as Array<{ src: string; dst: string }>,
    findPackageSkillsDir: [] as Array<{ pkg: string; binaryPath: string }>,
  };
  const warn = vi.fn();
  const info = vi.fn();

  const deps: CliProvisionDeps = {
    cliRoot: "/cli-root",
    skillsRoot: "/skills-root",
    resolveExisting: vi.fn(async (pkgBinary: string) => {
      calls.resolveExisting.push(pkgBinary);
      return null;
    }),
    managedInstall: vi.fn(async (pkg: string, version: string, dir: string, binary: string) => {
      calls.managedInstall.push({ pkg, version, dir, binary });
      return `${dir}/bin/${binary}`;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      calls.writeFile.push({ path, content });
    }),
    chmod: vi.fn(async (path: string, mode: number) => {
      calls.chmod.push({ path, mode });
    }),
    mkdir: vi.fn(async (path: string, options?: { recursive?: boolean; mode?: number }) => {
      calls.mkdir.push({ path, options });
    }),
    rm: vi.fn(async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
      calls.rm.push({ path, options });
    }),
    copyDirIfAbsent: vi.fn(async (src: string, dst: string) => {
      calls.copyDirIfAbsent.push({ src, dst });
      return true;
    }),
    findPackageSkillsDir: vi.fn(async (pkg: string, binaryPath: string) => {
      calls.findPackageSkillsDir.push({ pkg, binaryPath });
      return null;
    }),
    log: { info, warn },
    ...overrides,
  };
  return { deps, calls, warn, info };
}

describe("provisionCli — resolution order", () => {
  it("uses the PATH hit and skips the managed install when it meets minVersion", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });

    const handle = await provisionCli(fakeSpec(), fakeInstance(), deps);

    expect(handle.binaryPath).toBe("/usr/local/bin/acme");
    expect(calls.managedInstall).toHaveLength(0);
  });

  it("resolves against spec.binary, never spec.package — a scoped package name (containing '/') can never be found on PATH", async () => {
    const { deps } = fakeDeps({
      resolveExisting: vi.fn(async () => null),
    });

    await provisionCli(fakeSpec(), fakeInstance(), deps);

    expect(deps.resolveExisting).toHaveBeenCalledWith("acme-cli");
    expect(deps.resolveExisting).not.toHaveBeenCalledWith("@acme/cli");
  });

  it("falls through to a managed install, with a warning, when the PATH hit is below minVersion", async () => {
    const { deps, calls, warn } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.1.9" })),
    });

    const handle = await provisionCli(fakeSpec(), fakeInstance(), deps);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("1.1.9");
    expect(warn.mock.calls[0]![0]).toContain("1.2.0");
    expect(calls.managedInstall).toEqual([
      { pkg: "@acme/cli", version: "1.2.3", dir: "/cli-root/@acme/cli@1.2.3", binary: "acme-cli" },
    ]);
    expect(handle.binaryPath).toBe("/cli-root/@acme/cli@1.2.3/bin/acme-cli");
  });

  it("goes straight to a managed install when nothing is found on PATH", async () => {
    const { deps, calls, warn } = fakeDeps();

    await provisionCli(fakeSpec(), fakeInstance(), deps);

    expect(warn).not.toHaveBeenCalled();
    expect(calls.managedInstall).toEqual([
      { pkg: "@acme/cli", version: "1.2.3", dir: "/cli-root/@acme/cli@1.2.3", binary: "acme-cli" },
    ]);
  });
});

describe("provisionCli — wrapper script", () => {
  it("writes an exact, shell-escaped wrapper at <cliRoot>/wrappers/<instance.id>.sh, 0600 under a 0700 parent", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const spec = fakeSpec({
      env: {
        API_TOKEN: "it's a test with spaces",
        PLAIN: "value",
      },
    });

    const handle = await provisionCli(spec, fakeInstance(), deps);

    // Keyed by instance.id, NOT spec.id — spec.id ("acme-cli") is a shared
    // provider constant, so a regression that keys off it instead of the
    // per-connect instance.id would still pass a naive "some wrapper got
    // written" check while silently reintroducing the two-connects
    // collision this fix exists to close.
    expect(handle.wrapperPath).toBe("/cli-root/wrappers/acme-instance-a1b2c3d4.sh");
    expect(calls.mkdir).toContainEqual({
      path: "/cli-root/wrappers",
      options: { recursive: true, mode: 0o700 },
    });
    // Index 0 is the wrapper; index 1 (asserted in the carrier-skill
    // describe block below) is the carrier skill's SKILL.md — every
    // provision now writes exactly those two files.
    expect(calls.writeFile).toHaveLength(2);
    expect(calls.writeFile[0]!.path).toBe("/cli-root/wrappers/acme-instance-a1b2c3d4.sh");
    expect(calls.writeFile[0]!.content).toBe(
      [
        "#!/bin/sh",
        "export API_TOKEN='it'\\''s a test with spaces'",
        "export PLAIN='value'",
        'exec "/usr/local/bin/acme" "$@"',
        "",
      ].join("\n"),
    );
    expect(calls.chmod).toEqual([
      { path: "/cli-root/wrappers/acme-instance-a1b2c3d4.sh", mode: 0o600 },
    ]);
  });

  it("regenerates the wrapper unconditionally on every provision (overwrite, not skip)", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });

    await provisionCli(fakeSpec(), fakeInstance(), deps);
    await provisionCli(fakeSpec(), fakeInstance(), deps);

    const wrapperWrites = calls.writeFile.filter((call) => call.path.endsWith(".sh"));
    expect(wrapperWrites).toHaveLength(2);
    expect(calls.chmod).toHaveLength(2);
  });
});

describe("provisionCli — skills seeding", () => {
  it("copies each named skill create-only from the package's skills dir into <skillsRoot>/<name>/", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => "/usr/local/lib/acme/skills"),
    });
    const spec = fakeSpec({ skills: ["deploy", "diagnose"] });

    const handle = await provisionCli(spec, fakeInstance(), deps);

    expect(calls.copyDirIfAbsent).toEqual([
      { src: "/usr/local/lib/acme/skills/deploy", dst: "/skills-root/deploy" },
      { src: "/usr/local/lib/acme/skills/diagnose", dst: "/skills-root/diagnose" },
    ]);
    expect(handle.seededSkills).toEqual(["deploy", "diagnose"]);
  });

  it("does not count an already-present skill (copyDirIfAbsent returns false) as newly seeded", async () => {
    const { deps } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => "/usr/local/lib/acme/skills"),
      copyDirIfAbsent: vi.fn(async () => false),
    });
    const spec = fakeSpec({ skills: ["deploy"] });

    const handle = await provisionCli(spec, fakeInstance(), deps);

    expect(handle.seededSkills).toEqual([]);
  });

  it("warns and skips a single skill whose source is missing, without failing the provision", async () => {
    const { deps, warn } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => "/usr/local/lib/acme/skills"),
      copyDirIfAbsent: vi.fn(async (src: string) => {
        if (src.endsWith("missing")) throw new Error("ENOENT: no such file or directory");
        return true;
      }),
    });
    const spec = fakeSpec({ skills: ["deploy", "missing"] });

    const handle = await provisionCli(spec, fakeInstance(), deps);

    expect(handle.seededSkills).toEqual(["deploy"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("missing");
  });

  it("warns once and skips every skill when the package's skills dir cannot be located, without failing the provision", async () => {
    const { deps, calls, warn } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => null),
    });
    const spec = fakeSpec({ skills: ["deploy", "diagnose"] });

    const handle = await provisionCli(spec, fakeInstance(), deps);

    expect(handle.seededSkills).toEqual([]);
    expect(calls.copyDirIfAbsent).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never calls findPackageSkillsDir when spec.skills is empty", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });

    const handle = await provisionCli(fakeSpec({ skills: [] }), fakeInstance(), deps);

    expect(handle.seededSkills).toEqual([]);
    expect(calls.findPackageSkillsDir).toHaveLength(0);
  });
});

describe("provisionCli — per-connect wrapper namespacing", () => {
  it("two connects of the same provider (identical spec.id) get two DISTINCT wrapper paths, each carrying its own env", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const instanceA = fakeInstance({ id: "acme-instance-aaaaaaaa", connectName: "Connect A" });
    const instanceB = fakeInstance({ id: "acme-instance-bbbbbbbb", connectName: "Connect B" });

    const handleA = await provisionCli(
      fakeSpec({ env: { TOKEN: "token-a" } }),
      instanceA,
      deps,
    );
    const handleB = await provisionCli(
      fakeSpec({ env: { TOKEN: "token-b" } }),
      instanceB,
      deps,
    );

    expect(handleA.wrapperPath).toBe("/cli-root/wrappers/acme-instance-aaaaaaaa.sh");
    expect(handleB.wrapperPath).toBe("/cli-root/wrappers/acme-instance-bbbbbbbb.sh");
    expect(handleA.wrapperPath).not.toBe(handleB.wrapperPath);

    const wrapperWrites = calls.writeFile.filter((call) => call.path.endsWith(".sh"));
    expect(wrapperWrites).toEqual([
      { path: handleA.wrapperPath, content: expect.stringContaining("token-a") },
      { path: handleB.wrapperPath, content: expect.stringContaining("token-b") },
    ]);
    // Neither wrapper's content leaks the other connect's credential.
    expect(wrapperWrites[0]!.content).not.toContain("token-b");
    expect(wrapperWrites[1]!.content).not.toContain("token-a");
  });

  it("disposing one connect's handle removes only its own wrapper — the other connect's wrapper survives", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const instanceA = fakeInstance({ id: "acme-instance-aaaaaaaa" });
    const instanceB = fakeInstance({ id: "acme-instance-bbbbbbbb" });

    const handleA = await provisionCli(fakeSpec(), instanceA, deps);
    const handleB = await provisionCli(fakeSpec(), instanceB, deps);

    await handleA.dispose();

    const removedPaths = calls.rm.map((call) => call.path);
    expect(removedPaths).toContain(handleA.wrapperPath);
    expect(removedPaths).not.toContain(handleB.wrapperPath);
    expect(removedPaths).not.toContain("/skills-root/acme-instance-bbbbbbbb");
  });
});

describe("provisionCli — carrier skill seeding", () => {
  it("seeds <skillsRoot>/<instance.id>/SKILL.md with the wrapper's absolute path, and NO env value anywhere in it", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const spec = fakeSpec({
      env: {
        API_TOKEN: "super-secret-token-xyz",
        APP_SECRET: "another-secret-value",
      },
    });
    const instance = fakeInstance();

    const handle = await provisionCli(spec, instance, deps);

    expect(handle.skillPath).toBe("/skills-root/acme-instance-a1b2c3d4/SKILL.md");
    expect(calls.mkdir).toContainEqual({
      path: "/skills-root/acme-instance-a1b2c3d4",
      options: { recursive: true },
    });

    const skillWrite = calls.writeFile.find((call) => call.path === handle.skillPath);
    expect(skillWrite).toBeDefined();
    const content = skillWrite!.content;

    // The absolute wrapper path is embedded — this is the whole point of
    // the carrier skill: it's the only place in the codebase that names the
    // wrapper, so a session can actually find and invoke it.
    expect(content).toContain(handle.wrapperPath);
    // Provider/connect display identity is embedded too.
    expect(content).toContain(instance.connectName);
    expect(content).toContain(instance.provider);
    // Valid, minimal SKILL.md frontmatter (name + description).
    expect(content).toMatch(/^---\nname: acme-instance-a1b2c3d4\ndescription: /u);

    // No secret ever appears in the skill content — only the wrapper path
    // (which itself carries the credentials, opaquely) is referenced.
    expect(content).not.toContain("super-secret-token-xyz");
    expect(content).not.toContain("another-secret-value");
  });

  it("overwrites the carrier skill unconditionally on re-provision (not create-only)", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const instance = fakeInstance();

    await provisionCli(fakeSpec(), instance, deps);
    await provisionCli(fakeSpec(), instance, deps);

    const skillWrites = calls.writeFile.filter((call) =>
      call.path.endsWith("/SKILL.md"),
    );
    expect(skillWrites).toHaveLength(2);
    expect(skillWrites[0]!.path).toBe(skillWrites[1]!.path);
  });

  it("two connects of the same provider get two DISTINCT carrier skill directories", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const instanceA = fakeInstance({ id: "acme-instance-aaaaaaaa", connectName: "Connect A" });
    const instanceB = fakeInstance({ id: "acme-instance-bbbbbbbb", connectName: "Connect B" });

    const handleA = await provisionCli(fakeSpec(), instanceA, deps);
    const handleB = await provisionCli(fakeSpec(), instanceB, deps);

    expect(handleA.skillPath).toBe("/skills-root/acme-instance-aaaaaaaa/SKILL.md");
    expect(handleB.skillPath).toBe("/skills-root/acme-instance-bbbbbbbb/SKILL.md");
    expect(handleA.skillPath).not.toBe(handleB.skillPath);

    const skillWrites = calls.writeFile.filter((call) => call.path.endsWith("/SKILL.md"));
    expect(skillWrites.map((call) => call.path)).toEqual([
      handleA.skillPath,
      handleB.skillPath,
    ]);
  });

  it("dispose removes the carrier skill directory alongside the wrapper", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const instance = fakeInstance();

    const handle = await provisionCli(fakeSpec(), instance, deps);
    await handle.dispose();

    expect(calls.rm).toContainEqual({
      path: "/skills-root/acme-instance-a1b2c3d4",
      options: { force: true, recursive: true },
    });
    expect(calls.rm).toContainEqual({
      path: handle.wrapperPath,
      options: { force: true },
    });
  });
});

describe("provisionCli — dispose", () => {
  it("removes the wrapper script AND the carrier skill directory, leaving the managed install and curated skills untouched", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => "/usr/local/lib/acme/skills"),
    });
    const handle = await provisionCli(
      fakeSpec({ skills: ["deploy"] }),
      fakeInstance(),
      deps,
    );

    await handle.dispose();

    expect(calls.rm).toEqual([
      { path: "/cli-root/wrappers/acme-instance-a1b2c3d4.sh", options: { force: true } },
      {
        path: "/skills-root/acme-instance-a1b2c3d4",
        options: { force: true, recursive: true },
      },
    ]);
  });

  it("is idempotent — a second dispose() is a no-op", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const handle = await provisionCli(fakeSpec(), fakeInstance(), deps);

    await handle.dispose();
    await handle.dispose();

    // One rm for the wrapper, one for the carrier skill directory — a
    // second dispose() call adds none of either.
    expect(calls.rm).toHaveLength(2);
  });

  it("resolves without throwing, and logs a warning, when removing the wrapper fails — the carrier skill is still removed", async () => {
    const { deps, warn, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    // Wraps (not replaces) the default `rm` so calls.rm still records every
    // attempt — only the wrapper path (".sh") is made to fail.
    const recordingRm = deps.rm;
    deps.rm = vi.fn(async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
      await recordingRm(path, options);
      if (path.endsWith(".sh")) throw new Error("EACCES: permission denied");
    });
    const handle = await provisionCli(fakeSpec(), fakeInstance(), deps);

    // The center's "cli" applier disposer fires this via `void
    // handle.dispose()` — fire-and-forget. If this rejected, it would
    // surface as an unhandled promise rejection with nothing to catch it,
    // which can crash the whole DSH runtime process over one connector's
    // wrapper failing to delete.
    await expect(handle.dispose()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("acme-cli");
    // The wrapper removal failure doesn't block the (independent) attempt
    // to remove the carrier skill directory — it still gets removed.
    expect(calls.rm).toContainEqual({
      path: "/skills-root/acme-instance-a1b2c3d4",
      options: { force: true, recursive: true },
    });

    // Idempotent even after a failed attempt: disposed is latched before
    // the rm calls, so a second dispose() never retries either one.
    await handle.dispose();
    expect(deps.rm).toHaveBeenCalledTimes(2);
  });

  it("resolves without throwing, and logs a warning, when removing the carrier skill directory fails — the wrapper is still removed", async () => {
    const { deps, warn, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    // Wraps (not replaces) the default `rm` so calls.rm still records every
    // attempt — only the carrier skill directory path (not ending in ".sh")
    // is made to fail.
    const recordingRm = deps.rm;
    deps.rm = vi.fn(async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
      await recordingRm(path, options);
      if (!path.endsWith(".sh")) throw new Error("EACCES: permission denied");
    });
    const handle = await provisionCli(fakeSpec(), fakeInstance(), deps);

    await expect(handle.dispose()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("carrier skill");
    // The carrier skill removal failure doesn't block the (independent)
    // wrapper removal — it still succeeded.
    expect(calls.rm).toContainEqual({
      path: handle.wrapperPath,
      options: { force: true },
    });
  });
});
