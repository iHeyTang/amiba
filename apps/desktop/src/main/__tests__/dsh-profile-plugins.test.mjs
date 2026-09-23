import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DshProfilePluginManager,
  assertDshPackageName,
  isRegistryDependencySpec,
  listDshProfilePlugins,
  packageProvider,
  registryPackageName,
} from "../dsh-profile-plugins.ts";

const packageName = "@example/dsh-plugin-demo";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "amiba-dsh-plugins-"));
  const profileDir = path.join(root, "home", "profiles", "amiba-desktop");
  const profileManifest = path.join(profileDir, "package.json");
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    profileManifest,
    `${JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } },
    })}\n`,
  );
  await writeFile(path.join(profileDir, "cordis.patch.yml"), "[]\n");
  await writeFile(path.join(profileDir, "pnpm-workspace.yaml"), "packages:\n  - .\n");
  return {
    root,
    paths: {
      profileName: "amiba-desktop",
      root,
      home: path.join(root, "home"),
      agentsHome: path.join(root, "agents"),
      runtimeDir: path.join(root, "runtime"),
      runtimeBinDir: path.join(root, "runtime", "node", "bin"),
      runtimeAppBinDir: path.join(root, "runtime", "app", "node_modules", ".bin"),
      node: path.join(root, "runtime", "node", "bin", "node"),
      entrypoint: path.join(root, "runtime", "dsh.js"),
      amibaBundleManifests: [path.join(root, "runtime", "amiba", "package.json")],
      amibaBundlePatches: [path.join(root, "runtime", "amiba", "cordis.patch.yml")],
      profileDir,
      profileManifest,
      profilePatch: path.join(profileDir, "cordis.patch.yml"),
      profileWorkspace: path.join(profileDir, "pnpm-workspace.yaml"),
      profileLock: path.join(profileDir, "pnpm-lock.yaml"),
      bundleMarker: path.join(root, "runtime", "runtime-manifest.json"),
    },
  };
}

async function writeInstalledBundle(paths, requestedSpec = "1.0.0") {
  const directory = path.join(
    paths.profileDir,
    "node_modules",
    "@example",
    "dsh-plugin-demo",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "cordis.patch.yml"), "[]\n");
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({
      name: packageName,
      version: "1.0.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    })}\n`,
  );
  const manifest = JSON.parse(await readFile(paths.profileManifest, "utf8"));
  manifest.dependencies[packageName] = requestedSpec;
  manifest.dsh.profile.bundles.push(packageName);
  await writeFile(paths.profileManifest, `${JSON.stringify(manifest)}\n`);
}

test("accepts registry package specs but rejects path and option injection", () => {
  assert.equal(registryPackageName(`${packageName}@1.2.3`), packageName);
  assert.equal(registryPackageName("dsh-plugin-demo@next"), "dsh-plugin-demo");
  assert.equal(assertDshPackageName(packageName), packageName);
  assert.equal(isRegistryDependencySpec("1.2.3"), true);
  assert.equal(isRegistryDependencySpec("file:.amiba/plugin.tgz"), false);
  assert.equal(isRegistryDependencySpec("git+https://example.com/plugin.git"), false);
  assert.throws(() => registryPackageName("file:../plugin.tgz"), /registry package/u);
  assert.throws(() => registryPackageName("--global"), /registry package/u);
  assert.throws(() => assertDshPackageName("../plugin"), /Invalid npm package/u);
});

test("lists profile dependencies and marks only active DSH bundles", async () => {
  const { root, paths } = await fixture();
  try {
    await writeInstalledBundle(paths);
    assert.deepEqual(await listDshProfilePlugins(paths), [
      {
        packageName,
        requestedSpec: "1.0.0",
        version: "1.0.0",
        bundle: true,
        provider: "unknown",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs through the official command seam and validates the composed tree", async () => {
  const { root, paths } = await fixture();
  const commands = [];
  const lifecycle = [];
  const runtime = {
    ensureManagedProfile: async () => {},
    stop: async () => lifecycle.push("stop"),
    ensureStarted: async () => lifecycle.push("start"),
  };
  try {
    const manager = new DshProfilePluginManager({
      paths,
      runtime,
      runCommand: async (args) => {
        commands.push([...args]);
        if (args[0] === "plugin") await writeInstalledBundle(paths);
        return { stdout: "", stderr: "" };
      },
    });
    const result = await manager.installRegistry(`${packageName}@1.0.0`);
    assert.equal(result.action, "install");
    assert.equal(result.packageName, packageName);
    assert.equal(result.packages[0]?.bundle, true);
    assert.deepEqual(commands, [
      [
        "plugin",
        "--profile",
          "amiba-desktop",
        "add",
        "-w",
        "--save-exact",
        `${packageName}@1.0.0`,
      ],
        ["--profile", "amiba-desktop", "--dump-config"],
    ]);
    assert.deepEqual(lifecycle, ["stop", "start"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores the complete profile and restarts the previous graph on failure", async () => {
  const { root, paths } = await fixture();
  const original = await readFile(paths.profileManifest, "utf8");
  const lifecycle = [];
  try {
    const manager = new DshProfilePluginManager({
      paths,
      runtime: {
        ensureManagedProfile: async () => {},
        stop: async () => lifecycle.push("stop"),
        ensureStarted: async () => lifecycle.push("start"),
      },
      runCommand: async (args) => {
        if (args[0] === "plugin") {
          await writeInstalledBundle(paths);
          throw new Error("simulated pnpm failure");
        }
        return { stdout: "", stderr: "" };
      },
    });
    await assert.rejects(
      manager.installRegistry(`${packageName}@1.0.0`),
      /simulated pnpm failure/u,
    );
    assert.equal(await readFile(paths.profileManifest, "utf8"), original);
    assert.deepEqual(lifecycle, ["stop", "stop", "start"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires local archive plugins to be updated from a new archive", async () => {
  const { root, paths } = await fixture();
  const commands = [];
  const lifecycle = [];
  try {
    await writeInstalledBundle(paths, "file:.amiba/plugin-archives/demo.tgz");
    const manager = new DshProfilePluginManager({
      paths,
      runtime: {
        ensureManagedProfile: async () => {},
        stop: async () => lifecycle.push("stop"),
        ensureStarted: async () => lifecycle.push("start"),
      },
      runCommand: async (args) => {
        commands.push([...args]);
        return { stdout: "", stderr: "" };
      },
    });
    await assert.rejects(
      manager.update(packageName),
      /select a new \.tgz/u,
    );
    assert.deepEqual(commands, []);
    assert.deepEqual(lifecycle, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rolls back a plugin package with a missing native entry", async () => {
  const { root, paths } = await fixture();
  const original = await readFile(paths.profileManifest, "utf8");
  try {
    const manager = new DshProfilePluginManager({ paths,
      runtime: { ensureManagedProfile: async () => {}, stop: async () => {}, ensureStarted: async () => {} },
      runCommand: async () => {
        await writeInstalledBundle(paths);
        const filename = path.join(paths.profileDir, "node_modules", packageName, "package.json");
        const manifest = JSON.parse(await readFile(filename, "utf8"));
        manifest.dsh.native = "./missing.cjs";
        await writeFile(filename, JSON.stringify(manifest));
        return { stdout: "", stderr: "" };
      },
    });
    await assert.rejects(manager.installRegistry(packageName), /ENOENT/);
    assert.equal(await readFile(paths.profileManifest, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("inventory follows the active profile and uses runtime inventory for package origin", async () => {
  const { root, paths } = await fixture();
  try {
    await writeInstalledBundle(paths);
    const runtimeManifest = path.resolve(paths.runtimeAppBinDir, "../..", "package.json");
    await mkdir(path.dirname(runtimeManifest), { recursive: true });
    const browser = "@amiba/dsh-plugin-browser-provider-electron";
    const external = "@amiba/dsh-plugin-user-example";
    await writeFile(runtimeManifest, JSON.stringify({ dependencies: {} }));
    const bundledBrowser = path.resolve(paths.runtimeAppBinDir, "..", browser, "package.json");
    await mkdir(path.dirname(bundledBrowser), { recursive: true });
    await writeFile(bundledBrowser, JSON.stringify({ name: browser }));
    let activeProfileManifest = paths.profileManifest;
    const manager = new DshProfilePluginManager({ paths, runtime: {
      get activeProfileManifest() { return activeProfileManifest; },
      async ensureManagedProfile() {}, async ensureStarted() {}, async stop() {},
    } });
    assert.equal((await manager.list()).packages[0].source, "external");
    const active = path.join(root, "dev", "package.json");
    await mkdir(path.dirname(active), { recursive: true });
    await writeFile(active, JSON.stringify({ dependencies: { [browser]: "link:/runtime/browser", [external]: "link:/projects/example" }, amibaDevelopmentPackages: [external] }));
    activeProfileManifest = active;
    const result = (await manager.list()).packages;
    assert.equal(result.find(p => p.packageName === browser).source, "internal");
    assert.equal(result.find(p => p.packageName === browser).mutable, false);
    assert.equal(result.find(p => p.packageName === external).source, "external");
    assert.equal(result.find(p => p.packageName === external).development, true);
    assert.equal(result.find(p => p.packageName === external).mutable, false);
    activeProfileManifest = paths.profileManifest;
    assert.equal((await manager.list()).packages[0].mutable, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("provider metadata is independent of package scope and installation source", () => {
  assert.equal(packageProvider({ name: "@deepseek-ai/fake" }).provider, "unknown");
  assert.equal(packageProvider({ repository: { url: "git+https://github.com/deepseek-ai/deepseek-harness.git" } }).provider, "dsh");
  assert.equal(packageProvider({ repository: "https://github.com/iHeyTang/amiba" }).provider, "amiba");
  assert.deepEqual(packageProvider({ author: { name: "Alice", email: "private@example.com" } }), { provider: "third-party", author: "Alice" });
  assert.deepEqual(packageProvider({ author: "Bob <private@example.com>" }), { provider: "third-party", author: "Bob" });
  assert.equal(packageProvider({ author: "Amiba" }).provider, "amiba");
  assert.equal(packageProvider(null).provider, "unknown");
});

test("reads metadata for transitive Loader packages without making them externally manageable", async () => {
  const { root, paths } = await fixture();
  try {
    const name = "@vendor/bundled-plugin";
    const file = path.resolve(paths.runtimeAppBinDir, "..", name, "package.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ name, author: "Alice", version: "2" }));
    const manager = new DshProfilePluginManager({ paths, runtime: { async ensureManagedProfile() {}, async ensureStarted() {}, async stop() {} } });
    const { packages } = await manager.list([name, name, "../../secret"]);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].source, "internal");
    assert.equal(packages[0].provider, "third-party");
    assert.equal(packages[0].author, "Alice");
    assert.equal(packages[0].mutable, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
