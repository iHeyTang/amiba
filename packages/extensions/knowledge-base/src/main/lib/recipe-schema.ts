/**
 * Per-provider env schema bridge: `gbrain providers env <id>`.
 *
 * The CLI prints:
 *   <Name> (<id>)
 *   <blank>
 *   Required:
 *     KEY                              ✓ set
 *     OTHER_KEY                        ✗ not set
 *
 *   Optional:
 *     KEY                              ✓ set
 *
 *   Setup: <url>
 *
 *   <free-form setup hint paragraph>
 *
 * We only parse the structured parts (required, optional, setup_url).
 * The `set / not set` annotation is recomputed on the renderer from
 * the overrides store anyway, so we ignore it here.
 */

import { spawn } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const SPAWN_TIMEOUT_MS = 8_000

export interface ProviderEnvSchema {
  required: string[]
  optional: string[]
  setupUrl?: string
}

export interface ProvidersEnvResult {
  ok: boolean
  schema?: ProviderEnvSchema
  binary: string
  error?: string
}

function findGBrainBinary(): string {
  const explicit = process.env.GBRAIN_BIN
  if (explicit && existsSync(explicit)) return explicit
  const candidates = [
    join(homedir(), ".bun", "bin", "gbrain"),
    "/opt/homebrew/bin/gbrain",
    "/usr/local/bin/gbrain",
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return "gbrain"
}

/** Pure parser, exported for inline review (no unit-test infra in this repo). */
export function parseEnvOutput(stdout: string): ProviderEnvSchema {
  const lines = stdout.split(/\r?\n/)
  const required: string[] = []
  const optional: string[] = []
  let setupUrl: string | undefined
  let mode: "required" | "optional" | null = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === "Required:") {
      mode = "required"
      continue
    }
    if (line === "Optional:") {
      mode = "optional"
      continue
    }
    if (line.startsWith("Setup:")) {
      setupUrl = line.slice("Setup:".length).trim() || undefined
      mode = null
      continue
    }
    // Blank line / free text ends any list mode.
    if (line.trim() === "" || !line.startsWith("  ")) {
      mode = null
      continue
    }
    // Indented row: `  KEY            ✓ set`.
    const token = line.trim().split(/\s+/)[0]
    if (!/^[A-Z][A-Z0-9_]*$/.test(token)) continue
    if (mode === "required") required.push(token)
    else if (mode === "optional") optional.push(token)
  }
  return { required, optional, setupUrl }
}

export async function runProvidersEnv(
  id: string,
): Promise<ProvidersEnvResult> {
  const binary = findGBrainBinary()
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    return { ok: false, binary, error: `invalid provider id: ${id}` }
  }
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (r: ProvidersEnvResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, ["providers", "env", id], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (e) {
      finish({ ok: false, binary, error: (e as Error).message ?? String(e) })
      return
    }

    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8")
    })
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8")
    })
    child.on("error", (err: Error) => {
      finish({ ok: false, binary, error: err.message ?? String(err) })
    })
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        /* best effort */
      }
      finish({
        ok: false,
        binary,
        error: `gbrain providers env ${id} timed out after ${SPAWN_TIMEOUT_MS}ms`,
      })
    }, SPAWN_TIMEOUT_MS)

    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0 && stdout.trim().length === 0) {
        finish({
          ok: false,
          binary,
          error:
            stderr.trim() || `gbrain providers env ${id} exited ${code}`,
        })
        return
      }
      finish({ ok: true, schema: parseEnvOutput(stdout), binary })
    })
  })
}
