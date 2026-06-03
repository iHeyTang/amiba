/**
 * Subprocess bridge for gbrain CLI commands that have no MCP equivalent.
 *
 * Today this covers `gbrain providers list` — the recipe registry lives
 * in TypeScript inside the gbrain package and isn't surfaced over the
 * HTTP MCP transport. Without spawning the CLI, the desktop has to
 * hard-code a mirror of the provider list, which goes stale every time
 * upstream adds a recipe. Spawning is the lesser evil.
 *
 * `gbrain config show / set / unset` is intentionally NOT bridged here
 * even though it would also be useful — those commands talk to the
 * brain DB, which is unreliable when the macOS WASM bug bites or when
 * `gbrain serve --http` holds the PGLite lock. We can revisit when
 * upstream exposes a config plane over MCP.
 */

import { spawn, spawnSync } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const SPAWN_TIMEOUT_MS = 8_000

/**
 * Resolve a usable `gbrain` binary path. Electron-launched processes on
 * macOS often inherit a stripped PATH that omits `~/.bun/bin`, so a
 * bare `spawn("gbrain", …)` fails for users who installed via Bun even
 * though the same command works in their terminal. We probe the most
 * common install locations and fall back to PATH.
 */
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

  // Last resort: $PATH lookup at exec time.
  return "gbrain"
}

/**
 * One row in the `gbrain providers list` table. Capabilities use a
 * loose string-enum (`yes` / `—`) because that's what the CLI prints;
 * the renderer maps them to UI badges.
 */
export interface GBrainProvider {
  id: string
  tier: string
  embed: string
  expand: string
  chat: string
  /** Whether `auth_env.required` is satisfied for this provider. */
  ready: boolean
  /** Env var name reported as missing when `ready=false`. */
  missing_env?: string
  /** Raw status string (`✓ ready` / `✗ missing OPENAI_API_KEY`). */
  status_raw: string
}

export interface ListProvidersResult {
  ok: boolean
  providers?: GBrainProvider[]
  /** Resolved binary path we shelled out to. Always populated. */
  binary: string
  error?: string
}

/**
 * Parse a single row from `gbrain providers list`.
 *
 * Column layout (header line `PROVIDER  TIER  EMBED  EXPAND  CHAT  STATUS`):
 *   - First 5 columns are tokens with a constrained vocabulary
 *     (`yes` / `—`), so splitting on 2+ whitespace is unambiguous.
 *   - The 6th column (STATUS) can contain spaces (`✗ missing X`), so
 *     we re-join the tail.
 */
function parseProviderRow(line: string): GBrainProvider | null {
  const parts = line.trim().split(/\s{2,}/)
  if (parts.length < 6) return null
  const [id, tier, embed, expand, chat, ...rest] = parts
  const status_raw = rest.join(" ")
  // STATUS examples:
  //   "✓ ready"
  //   "✗ missing OPENAI_API_KEY"
  //   "✗ missing setup"
  const ready = status_raw.startsWith("✓")
  let missing_env: string | undefined
  if (!ready) {
    const m = status_raw.match(/missing\s+([A-Z][A-Z0-9_]*)/)
    if (m) missing_env = m[1]
  }
  return { id, tier, embed, expand, chat, ready, missing_env, status_raw }
}

/**
 * Run `gbrain providers list` and parse the table.
 *
 * The CLI prints to stdout. Header + separator + N data rows. We tolerate
 * a non-zero exit if some rows were already emitted — gbrain occasionally
 * exits 1 when at least one recipe is unreachable, but the table itself
 * is still useful.
 */
export async function runProvidersList(): Promise<ListProvidersResult> {
  const binary = findGBrainBinary()
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (result: ListProvidersResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, ["providers", "list"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (e) {
      finish({
        ok: false,
        binary,
        error: (e as Error).message ?? String(e),
      })
      return
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (err: Error) => {
      finish({
        ok: false,
        binary,
        error: err.message ?? String(err),
      })
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
        error: `gbrain providers list timed out after ${SPAWN_TIMEOUT_MS}ms`,
      })
    }, SPAWN_TIMEOUT_MS)

    child.on("close", () => {
      clearTimeout(timer)
      const lines = stdout.split(/\r?\n/)
      // Skip header (PROVIDER ...) and separator (------) lines.
      const dataLines = lines.filter(
        (l) =>
          l.trim().length > 0 &&
          !l.startsWith("PROVIDER") &&
          !/^-{4,}/.test(l.trim()),
      )
      const providers = dataLines
        .map(parseProviderRow)
        .filter((r): r is GBrainProvider => r !== null)
      if (providers.length === 0) {
        finish({
          ok: false,
          binary,
          error:
            stderr.trim() ||
            "gbrain providers list returned no parsable rows",
        })
        return
      }
      finish({ ok: true, providers, binary })
    })
  })
}

/**
 * Quick liveness probe — used to decide whether to even render the
 * providers section in the GUI. Returns the binary path on success.
 */
export function probeGBrainBinary(): { ok: boolean; binary: string; version?: string; error?: string } {
  const binary = findGBrainBinary()
  try {
    const r = spawnSync(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
      env: process.env,
    })
    if (r.error) return { ok: false, binary, error: r.error.message }
    if (r.status !== 0) {
      return {
        ok: false,
        binary,
        error: r.stderr?.toString().trim() || `exit ${r.status}`,
      }
    }
    return { ok: true, binary, version: r.stdout?.toString().trim() }
  } catch (e) {
    return { ok: false, binary, error: (e as Error).message ?? String(e) }
  }
}

export {
  parseEnvOutput,
  runProvidersEnv,
  type ProviderEnvSchema,
  type ProvidersEnvResult,
} from "./recipe-schema"
