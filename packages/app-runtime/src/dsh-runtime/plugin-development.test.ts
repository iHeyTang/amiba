import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { createDevelopmentProfile, resolveManagedDshRuntimePaths } from "./index.js"

it("keeps profile dependencies with private manifests and resolves installation fallbacks", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "amiba profile ")))
  const base = { ...resolveManagedDshRuntimePaths({ surface: "desktop", home: path.join(root, "home"), runtimeDir: path.join(root, "runtime") }), node: process.execPath }
  const write = async (file: string, data: object) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(data))
  }
  let development: Awaited<ReturnType<typeof createDevelopmentProfile>> | undefined
  try {
    const runtimeModules = path.join(base.runtimeDir, "app/node_modules")
    const boot = createRequire(new URL("../../../../plugins/dsh-plugin-catalog/package.json", import.meta.url)).resolve("@deepseek-ai/dsh-app-boot/package.json")
    await mkdir(path.join(runtimeModules, "@deepseek-ai"), { recursive: true })
    await symlink(path.dirname(boot), path.join(runtimeModules, "@deepseek-ai/dsh-app-boot"), process.platform === "win32" ? "junction" : "dir")
    const original = { dependencies: { "dsh-plugin-private": "1", "dsh-plugin-fallback": "1" }, dsh: { profile: { bundles: [] } } }
    await write(base.profileManifest, original)
    const local = path.join(base.profileDir, "node_modules/dsh-plugin-private")
    const fallback = path.join(runtimeModules, "dsh-plugin-fallback")
    for (const [name, directory] of [["dsh-plugin-private", local], ["dsh-plugin-fallback", fallback]]) {
      await write(path.join(directory!, "package.json"), { name, exports: { ".": "./lib/index.js" } })
    }
    // A conflicting installation copy must not replace the profile's dependency.
    await write(path.join(runtimeModules, "dsh-plugin-private/package.json"), { name: "dsh-plugin-private" })
    development = await createDevelopmentProfile(base, [])
    expect(await realpath(path.join(development.paths.profileDir, "node_modules/dsh-plugin-private"))).toBe(local)
    expect(await realpath(path.join(development.paths.profileDir, "node_modules/dsh-plugin-fallback"))).toBe(fallback)
    expect(JSON.parse(await readFile(base.profileManifest, "utf8"))).toEqual(original)
    // Real ESM resolution: nextResolve mutates its context after a failed
    // host lookup. A nested DSH dependency must still resolve at its caller.
    const caller = path.join(root, "linked-plugin/index.mjs")
    const nested = path.join(root, "linked-plugin/node_modules/@deepseek-ai/nested-only")
    const hostShared = path.join(runtimeModules, "@deepseek-ai/shared")
    const localShared = path.join(root, "linked-plugin/node_modules/@deepseek-ai/shared")
    for (const directory of [nested, hostShared, localShared]) {
      await write(path.join(directory, "package.json"), { type: "module", exports: "./index.js" })
      await writeFile(path.join(directory, "index.js"), "export default true")
    }
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", development.preload, "--experimental-import-meta-resolve", "--input-type=module", "--eval",
      `console.log(JSON.stringify([import.meta.resolve('@deepseek-ai/nested-only', ${JSON.stringify(pathToFileURL(caller).href)}), import.meta.resolve('@deepseek-ai/shared', ${JSON.stringify(pathToFileURL(caller).href)})]))`,
    ])
    expect(JSON.parse(stdout)).toEqual([pathToFileURL(path.join(nested, "index.js")).href, pathToFileURL(path.join(hostShared, "index.js")).href])
  } finally {
    await development?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
