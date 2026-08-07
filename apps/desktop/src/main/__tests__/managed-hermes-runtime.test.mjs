import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const {
  MANAGED_HERMES_RUNTIME,
  assertValidManagedHermesRuntimeManifest,
  bundledHermesRuntimeDir,
  buildManagedHermesEnvironment,
  expectedBundledHermesRuntimeMarker,
  resolveManagedHermesPaths,
} = await import("../managed-hermes-runtime.ts");

test("managed runtime manifest is immutable and reproducibly pinned", () => {
  assertValidManagedHermesRuntimeManifest();
  assert.equal(MANAGED_HERMES_RUNTIME.commit.length, 40);
  assert.match(MANAGED_HERMES_RUNTIME.pythonVersion, /^3\.11\.\d+$/);
  assert.match(MANAGED_HERMES_RUNTIME.nodeVersion, /^22\.\d+\.\d+$/);
  assert.match(MANAGED_HERMES_RUNTIME.playwrightVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(Object.isFrozen(MANAGED_HERMES_RUNTIME), true);
});

test("managed paths isolate code and data beneath Amiba userData", () => {
  const userData = "/Users/test/Library/Application Support/Amiba";
  const paths = resolveManagedHermesPaths(userData, "darwin");
  assert.equal(paths.hermesHome, path.join(userData, "hermes", "home"));
  assert.equal(
    paths.binary,
    path.join(
      userData,
      "hermes",
      "runtimes",
      `${MANAGED_HERMES_RUNTIME.commit}-bundle-v${MANAGED_HERMES_RUNTIME.bundleSchemaVersion}`,
      "python",
      "bin",
      "python3.11",
    ),
  );
  assert.equal(paths.entrypoint, path.join(paths.runtimeDir, "hermes-agent", "hermes"));
});

test("managed environment owns Hermes home and private service ports", () => {
  const paths = resolveManagedHermesPaths("/tmp/amiba-user-data", "linux");
  const env = buildManagedHermesEnvironment({ HOME: "/Users/test" }, paths);
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.HERMES_HOME, paths.hermesHome);
  assert.equal(env.HERMES_INSTALL_DIR, paths.installDir);
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, paths.browsersDir);
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
    platform: "darwin",
    arch: "arm64",
  });
});

test("bundle lookup uses app resources and rejects relative overrides", () => {
  assert.equal(
    bundledHermesRuntimeDir("/work/desktop", "/Applications/Amiba/Resources", false),
    "/work/desktop/resources/hermes-runtime",
  );
  assert.equal(
    bundledHermesRuntimeDir("/work/desktop", "/Applications/Amiba/Resources", true),
    "/Applications/Amiba/Resources/resources/hermes-runtime",
  );
  assert.throws(() =>
    bundledHermesRuntimeDir("/work/desktop", "/Applications/Amiba/Resources", true, "relative"),
  );
});
