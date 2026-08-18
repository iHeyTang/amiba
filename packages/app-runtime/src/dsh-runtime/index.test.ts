import assert from "node:assert/strict"
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

test("pins one immutable DSH release and upstream commit", () => {
  assert.doesNotThrow(() => assertValidManagedDshRuntimeManifest())
  assert.equal(MANAGED_DSH_RUNTIME.version, "0.1.0-rc.6")
  assert.equal(
    MANAGED_DSH_RUNTIME.commit,
    "47f943859bef60e4160492346772ded9b24f765a",
  )
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
  assert.equal(
    resolveManagedDshRuntimeDir({
      env: { AMIBA_DSH_RUNTIME_DIR: "/opt/amiba/runtime" },
    }),
    "/opt/amiba/runtime",
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
    dshCommit: "47f943859bef60e4160492346772ded9b24f765a",
    dshVersion: "0.1.0-rc.6",
    nodeVersion: "22.22.0",
    amibaPluginRevision: "2026-08-16.2",
    platform: "linux",
    arch: "x64",
  })
})
