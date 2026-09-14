import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { managedDshEnvironment, resolveManagedDshRuntimePaths } from "./index.js"

it("runs node children from the managed runtime without any system Node on PATH", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "amiba environment ")))
  try {
    const paths = resolveManagedDshRuntimePaths({ surface: "desktop", home: path.join(root, "home"), runtimeDir: path.join(root, "runtime") })
    mkdirSync(paths.runtimeBinDir, { recursive: true })
    symlinkSync(process.execPath, paths.node, "file")
    const inherited = { PATH: "", DSH_HOME: "wrong", DSH_AGENTS_HOME: "wrong", AMIBA_DSH_API_TOKEN: "fixture" }
    const env = managedDshEnvironment(paths, inherited)
    expect(env.DSH_HOME).toBe(paths.home)
    expect(env.DSH_AGENTS_HOME).toBe(paths.agentsHome)
    expect(env.AMIBA_DSH_API_TOKEN).toBe("fixture")
    expect(inherited.DSH_HOME).toBe("wrong")
    expect(execFileSync("node", ["--eval", "process.stdout.write(process.versions.node)"], { env, encoding: "utf8" })).toBe(process.versions.node)
    expect(managedDshEnvironment(paths, { Path: "inherited" }).PATH).toBe([paths.runtimeAppBinDir, paths.runtimeBinDir, "inherited"].join(path.delimiter))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
