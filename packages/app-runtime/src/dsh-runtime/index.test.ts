import assert from "node:assert/strict"
import path from "node:path"
import { test } from "vitest"
import {
  MANAGED_DSH_RUNTIME,
  assertValidManagedDshRuntimeManifest,
  expectedManagedDshRuntimeMarker,
  managedDshProfileManifest,
  resolveManagedDshRuntimeDir,
  resolveManagedDshRuntimePaths,
  resolvePackagedManagedDshRuntimeDir,
} from "./index"

test("pins one immutable DSH release, and claims nothing it cannot verify", () => {
  assert.doesNotThrow(() => assertValidManagedDshRuntimeManifest())
  assert.equal(MANAGED_DSH_RUNTIME.version, "0.1.1-rc.2")
  // The manifest used to carry the upstream commit SHA. Nothing ever checked
  // it against the installed release — npm publishes no `gitHead` for these
  // packages, so it could not be derived from the artifact and could only be
  // hand-entered. It was shown as provenance in the dev banner, the runtime
  // diagnostics and the settings status page, which made it a claim that was
  // guaranteed to go stale on the next bump. Identity is already enforced by
  // two facts that ARE verifiable: prepare.mjs asks the installed runtime for
  // its own version and fails on mismatch, and the lockfile carries a content
  // integrity hash.
  assert.equal("commit" in MANAGED_DSH_RUNTIME, false)
})

test("resolves a shared Node-only runtime for the desktop surface", () => {
  const paths = resolveManagedDshRuntimePaths({
    surface: "desktop",
    home: "/Users/test/Library/Application Support/Amiba/dsh/home",
    runtimeDir: "/Applications/Amiba.app/Contents/Resources/resources/dsh-runtime",
    platform: "darwin",
  })
  assert.equal(
    paths.node,
    "/Applications/Amiba.app/Contents/Resources/resources/dsh-runtime/node/bin/node",
  )
  assert.equal(
    paths.entrypoint,
    "/Applications/Amiba.app/Contents/Resources/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh/lib/bin.js",
  )
  assert.equal(paths.profileName, "amiba-desktop")
  assert.equal(
    paths.profileManifest,
    "/Users/test/Library/Application Support/Amiba/dsh/home/profiles/amiba-desktop/package.json",
  )
  assert.equal(paths.amibaBundlePatches.length, 3)
})

test("resolves only surface-appropriate Amiba bundles", () => {
  const headless = resolveManagedDshRuntimePaths({
    surface: "headless",
    home: "/tmp/amiba/home",
    runtimeDir: "/tmp/amiba/runtime",
    platform: "linux",
  })
  assert.equal(headless.profileName, "amiba-headless")
  assert.equal(headless.amibaBundlePatches.length, 1)
  assert.match(headless.amibaBundlePatches[0], /dsh-bundle-amiba-core/u)
})

test("composes independent Core, Web, and Desktop bundles", () => {
  const manifest = managedDshProfileManifest("desktop", {
    name: "existing-web-profile",
    dependencies: { "third-party-plugin": "1.0.0" },
    dsh: {
      profile: {
        bundles: [
          "@deepseek-ai/dsh-base",
          "third-party-bundle",
          "@deepseek-ai/dsh-web-app",
          "@amiba/dsh-bundle-amiba-desktop",
        ],
      },
    },
  }) as { dsh: { profile: { bundles: string[] } } }
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "third-party-bundle",
    "@amiba/dsh-bundle-amiba-core",
    "@amiba/dsh-bundle-amiba-web",
    "@amiba/dsh-bundle-amiba-desktop",
  ])
})

test("resolves shared, configured, and packaged runtime roots", () => {
  const configured = path.resolve("amiba-test-runtime")
  assert.equal(
    resolveManagedDshRuntimeDir({
      env: { AMIBA_DSH_RUNTIME_DIR: configured },
    }),
    configured,
  )
  assert.equal(
    resolvePackagedManagedDshRuntimeDir(
      "/Applications/Amiba.app/Contents/Resources",
      "darwin",
    ),
    "/Applications/Amiba.app/Contents/Resources/resources/dsh-runtime",
  )
})

test("build marker contains every runtime compatibility dimension", () => {
  assert.deepEqual(expectedManagedDshRuntimeMarker("linux", "x64"), {
    schemaVersion: 7,
    dshVersion: "0.1.1-rc.2",
    nodeVersion: "22.22.0",
    amibaPluginRevision: "2026-08-16.2",
    platform: "linux",
    arch: "x64",
  })
})

test("migrates the desktop browser once and preserves removal across restarts", async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const path = await import("node:path")
  const { ensureManagedDshProfile } = await import("./index")
  const directory = await mkdtemp(path.join(tmpdir(), "amiba-browser-profile-"))
  try {
    const paths = resolveManagedDshRuntimePaths({ surface: "desktop", home: path.join(directory, "home"), runtimeDir: path.join(directory, "runtime") })
    await ensureManagedDshProfile(paths)
    const manifest = JSON.parse(await readFile(paths.profileManifest, "utf8"))
    const browser = "@amiba/dsh-plugin-browser-provider-electron"
    assert.equal(manifest.dsh.profile.optionalBrowserMigration, 1)
    assert.ok(manifest.dsh.profile.bundles.includes(browser))
    assert.match(manifest.dependencies[browser], /^link:/)
    delete manifest.dependencies[browser]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== browser)
    await writeFile(paths.profileManifest, JSON.stringify(manifest))
    await ensureManagedDshProfile(paths)
    const restarted = JSON.parse(await readFile(paths.profileManifest, "utf8"))
    assert.equal(browser in restarted.dependencies, false)
    assert.equal(restarted.dsh.profile.bundles.includes(browser), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
