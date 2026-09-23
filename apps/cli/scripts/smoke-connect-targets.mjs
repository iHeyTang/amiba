import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Exercise a real scaffold and its npm scripts without touching a running desktop.
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "amiba connect targets "))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, ...options })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}
try {
  const created = run(process.execPath, [cli, "plugin", "create", "demo", "--id", "demo", "--no-install"], { cwd: root, input: "\n" })
  assert.equal(created.status, 0, created.output)
  const project = join(root, "dsh-plugin-demo")
  const bin = join(project, "node_modules", ".bin")
  mkdirSync(bin, { recursive: true })
  if (process.platform === "win32") {
    writeFileSync(join(bin, "amiba.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`)
  } else {
    const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'"
    writeFileSync(join(bin, "amiba"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o755 })
  }
  const devHome = join(root, "dev-home")
  const releaseHome = join(root, "release-home")
  const env = { ...process.env, AMIBA_PLUGIN_DEV_HOME: devHome, AMIBA_PLUGIN_RELEASE_HOME: releaseHome, DSH_HOME: join(root, "wrong-home") }
  for (const [script, selected, excluded] of [["dev", devHome, releaseHome], ["connect:dev", devHome, releaseHome], ["connect:release", releaseHome, devHome]]) {
    const result = run(npm, ["run", script], { cwd: project, env, shell: process.platform === "win32" })
    assert.equal(result.status, 1, result.output)
    assert.ok(result.output.includes(`No running desktop found in: ${selected}`), result.output)
    assert.ok(!result.output.includes(excluded), result.output)
    assert.ok(!result.output.includes(env.DSH_HOME), result.output)
  }
  const invalid = run(process.execPath, [cli, "plugin", "dev", "--target", "typo"], { cwd: project })
  assert.equal(invalid.status, 1)
  assert.match(invalid.output, /Allowed choices are dev, release/)
  console.log("PASS: generated npm commands select their channel and reject invalid targets")
} finally {
  rmSync(root, { recursive: true, force: true })
}
