import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const {
  MANAGED_HERMES_RUNTIME,
  assertValidManagedHermesRuntimeManifest,
  bundledHermesRuntimeArtifactsMatch,
  bundledHermesRuntimeDir,
  buildManagedHermesEnvironment,
  expectedBundledHermesRuntimeMarker,
  managedHermesPatchSetHash,
  resolveManagedHermesPaths,
} = await import("../managed-hermes-runtime.ts");

test("managed runtime manifest is immutable and reproducibly pinned", () => {
  assertValidManagedHermesRuntimeManifest();
  assert.equal(MANAGED_HERMES_RUNTIME.commit.length, 40);
  assert.match(MANAGED_HERMES_RUNTIME.pythonVersion, /^3\.11\.\d+$/);
  assert.match(MANAGED_HERMES_RUNTIME.nodeVersion, /^22\.\d+\.\d+$/);
  assert.match(MANAGED_HERMES_RUNTIME.playwrightVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(MANAGED_HERMES_RUNTIME.bundleSchemaVersion, 4);
  assert.deepEqual(
    MANAGED_HERMES_RUNTIME.patches.map((patch) => patch.id),
    [
      "forward-moa-run-events",
      "forward-subagent-run-events",
      "api-server-clarify",
      "bundle-amiba-extensions-plugin",
    ],
  );
  for (const patch of MANAGED_HERMES_RUNTIME.patches) {
    assert.match(patch.sha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(patch), true);
  }
  assert.match(managedHermesPatchSetHash(), /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(MANAGED_HERMES_RUNTIME), true);
  assert.equal(Object.isFrozen(MANAGED_HERMES_RUNTIME.patches), true);
});

test("managed runtime supports retiring the final downstream patch", () => {
  const upstreamOnlyManifest = {
    ...MANAGED_HERMES_RUNTIME,
    patches: [],
  };

  assert.doesNotThrow(() =>
    assertValidManagedHermesRuntimeManifest(upstreamOnlyManifest),
  );
  assert.equal(
    managedHermesPatchSetHash(upstreamOnlyManifest),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("managed paths keep mutable data in userData and execute the bundled Runtime directly", () => {
  const userData = "/Users/test/Library/Application Support/Amiba";
  const runtime =
    "/Applications/Amiba.app/Contents/Resources/resources/hermes-runtime";
  const paths = resolveManagedHermesPaths(userData, runtime, "darwin");
  assert.equal(paths.hermesHome, path.join(userData, "hermes", "home"));
  assert.equal(paths.binary, path.join(runtime, "python", "bin", "python3.11"));
  assert.equal(paths.runtimeDir, runtime);
  assert.equal(paths.entrypoint, path.join(runtime, "hermes-agent", "hermes"));
});

test("managed environment owns Hermes home and private service ports", () => {
  const paths = resolveManagedHermesPaths(
    "/tmp/amiba-user-data",
    "/opt/amiba/resources/hermes-runtime",
    "linux",
  );
  const env = buildManagedHermesEnvironment(
    { HOME: "/Users/test", API_SERVER_KEY: "test-only-private-key" },
    paths,
  );
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.HERMES_HOME, paths.hermesHome);
  assert.equal(env.HERMES_INSTALL_DIR, paths.installDir);
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, paths.browsersDir);
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.API_SERVER_ENABLED, "true");
  assert.equal(env.API_SERVER_KEY, "test-only-private-key");
  assert.equal(env.API_SERVER_PORT, String(MANAGED_HERMES_RUNTIME.gatewayPort));
  assert.equal(
    env.AMIBA_HERMES_GATEWAY_BASE,
    `http://127.0.0.1:${MANAGED_HERMES_RUNTIME.gatewayPort}`,
  );
  assert.equal(env.AMIBA_MANAGED_HERMES, "1");
  assert.equal(env.AMIBA_MANAGED_HERMES_COMMIT, MANAGED_HERMES_RUNTIME.commit);
});

test("bundle marker pins platform, architecture, and every embedded runtime", () => {
  assert.deepEqual(expectedBundledHermesRuntimeMarker("darwin", "arm64"), {
    schemaVersion: MANAGED_HERMES_RUNTIME.bundleSchemaVersion,
    hermesCommit: MANAGED_HERMES_RUNTIME.commit,
    hermesVersion: MANAGED_HERMES_RUNTIME.version,
    pythonVersion: MANAGED_HERMES_RUNTIME.pythonVersion,
    nodeVersion: MANAGED_HERMES_RUNTIME.nodeVersion,
    playwrightVersion: MANAGED_HERMES_RUNTIME.playwrightVersion,
    hermesPatchSetHash: managedHermesPatchSetHash(),
    platform: "darwin",
    arch: "arm64",
  });
});

test("runtime artifact identity includes build flavor and local source revision", () => {
  const base = {
    ...expectedBundledHermesRuntimeMarker("darwin", "arm64"),
    buildFlavor: "release",
    sourceRevision: MANAGED_HERMES_RUNTIME.commit,
  };

  assert.equal(bundledHermesRuntimeArtifactsMatch(base, { ...base }), true);
  assert.equal(
    bundledHermesRuntimeArtifactsMatch(base, {
      ...base,
      buildFlavor: "development",
    }),
    false,
  );
  assert.equal(
    bundledHermesRuntimeArtifactsMatch(base, {
      ...base,
      sourceRevision: "local-source-revision",
    }),
    false,
  );
});

test("bundle lookup uses app resources and rejects relative overrides", () => {
  assert.equal(
    bundledHermesRuntimeDir(
      "/work/desktop",
      "/Applications/Amiba/Resources",
      false,
    ),
    "/work/desktop/resources/hermes-runtime",
  );
  assert.equal(
    bundledHermesRuntimeDir(
      "/work/desktop",
      "/Applications/Amiba/Resources",
      true,
    ),
    "/Applications/Amiba/Resources/resources/hermes-runtime",
  );
  assert.throws(() =>
    bundledHermesRuntimeDir(
      "/work/desktop",
      "/Applications/Amiba/Resources",
      true,
      "relative",
    ),
  );
});
