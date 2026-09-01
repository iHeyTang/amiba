import { describe, expect, it, vi } from "vitest";

import { provisionCli, type CliProvisionDeps } from "./cli-provision.js";
import type { CliProvisionSpec } from "./types.js";

function fakeSpec(overrides: Partial<CliProvisionSpec> = {}): CliProvisionSpec {
  return {
    id: "acme-cli",
    package: "@acme/cli",
    minVersion: "1.2.0",
    pinnedVersion: "1.2.3",
    env: {},
    skills: [],
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
    managedInstall: [] as Array<{ pkg: string; version: string; dir: string }>,
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
    managedInstall: vi.fn(async (pkg: string, version: string, dir: string) => {
      calls.managedInstall.push({ pkg, version, dir });
      return `${dir}/bin/${pkg.split("/").pop()}`;
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

    const handle = await provisionCli(fakeSpec(), deps);

    expect(handle.binaryPath).toBe("/usr/local/bin/acme");
    expect(calls.managedInstall).toHaveLength(0);
  });

  it("falls through to a managed install, with a warning, when the PATH hit is below minVersion", async () => {
    const { deps, calls, warn } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.1.9" })),
    });

    const handle = await provisionCli(fakeSpec(), deps);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("1.1.9");
    expect(warn.mock.calls[0]![0]).toContain("1.2.0");
    expect(calls.managedInstall).toEqual([
      { pkg: "@acme/cli", version: "1.2.3", dir: "/cli-root/@acme/cli@1.2.3" },
    ]);
    expect(handle.binaryPath).toBe("/cli-root/@acme/cli@1.2.3/bin/cli");
  });

  it("goes straight to a managed install when nothing is found on PATH", async () => {
    const { deps, calls, warn } = fakeDeps();

    await provisionCli(fakeSpec(), deps);

    expect(warn).not.toHaveBeenCalled();
    expect(calls.managedInstall).toEqual([
      { pkg: "@acme/cli", version: "1.2.3", dir: "/cli-root/@acme/cli@1.2.3" },
    ]);
  });
});

describe("provisionCli — wrapper script", () => {
  it("writes an exact, shell-escaped wrapper at <cliRoot>/wrappers/<id>.sh, 0600 under a 0700 parent", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const spec = fakeSpec({
      env: {
        API_TOKEN: "it's a test with spaces",
        PLAIN: "value",
      },
    });

    const handle = await provisionCli(spec, deps);

    expect(handle.wrapperPath).toBe("/cli-root/wrappers/acme-cli.sh");
    expect(calls.mkdir).toContainEqual({
      path: "/cli-root/wrappers",
      options: { recursive: true, mode: 0o700 },
    });
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.writeFile[0]!.path).toBe("/cli-root/wrappers/acme-cli.sh");
    expect(calls.writeFile[0]!.content).toBe(
      [
        "#!/bin/sh",
        "export API_TOKEN='it'\\''s a test with spaces'",
        "export PLAIN='value'",
        'exec "/usr/local/bin/acme" "$@"',
        "",
      ].join("\n"),
    );
    expect(calls.chmod).toEqual([{ path: "/cli-root/wrappers/acme-cli.sh", mode: 0o600 }]);
  });

  it("regenerates the wrapper unconditionally on every provision (overwrite, not skip)", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });

    await provisionCli(fakeSpec(), deps);
    await provisionCli(fakeSpec(), deps);

    expect(calls.writeFile).toHaveLength(2);
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

    const handle = await provisionCli(spec, deps);

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

    const handle = await provisionCli(spec, deps);

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

    const handle = await provisionCli(spec, deps);

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

    const handle = await provisionCli(spec, deps);

    expect(handle.seededSkills).toEqual([]);
    expect(calls.copyDirIfAbsent).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never calls findPackageSkillsDir when spec.skills is empty", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });

    const handle = await provisionCli(fakeSpec({ skills: [] }), deps);

    expect(handle.seededSkills).toEqual([]);
    expect(calls.findPackageSkillsDir).toHaveLength(0);
  });
});

describe("provisionCli — dispose", () => {
  it("removes only the wrapper script, leaving the managed install and seeded skills untouched", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
      findPackageSkillsDir: vi.fn(async () => "/usr/local/lib/acme/skills"),
    });
    const handle = await provisionCli(fakeSpec({ skills: ["deploy"] }), deps);

    await handle.dispose();

    expect(calls.rm).toEqual([
      { path: "/cli-root/wrappers/acme-cli.sh", options: { force: true } },
    ]);
  });

  it("is idempotent — a second dispose() is a no-op", async () => {
    const { deps, calls } = fakeDeps({
      resolveExisting: vi.fn(async () => ({ path: "/usr/local/bin/acme", version: "1.2.0" })),
    });
    const handle = await provisionCli(fakeSpec(), deps);

    await handle.dispose();
    await handle.dispose();

    expect(calls.rm).toHaveLength(1);
  });
});
