/**
 * "Make sure `gbrain serve --http` is up" primitive.
 *
 * gbrain's HTTP server is a long-running daemon — closing the parent
 * shell kills it. Users frequently install gbrain but forget to start
 * it (or it died after a logout), so every Brain-facing surface in the
 * desktop used to fail with a misleading "Could not reach gbrain" until
 * the user manually opened a terminal and ran the command.
 *
 * `ensureGBrainServeHttp()` collapses that into one call:
 *
 *   1. Probe `http://127.0.0.1:<port>/health` quickly. If a real gbrain
 *      answers, we're done — `alreadyRunning=true`.
 *   2. Otherwise spawn `gbrain serve --http --port <port>` **detached**
 *      with `stdio: "ignore"`, so the server outlives the desktop
 *      process (matches what a user typing the command in a terminal
 *      would experience — close the terminal, server keeps running).
 *      Detached + unref + stdio-ignore is also the only way to avoid
 *      the child being killed when Electron tears down.
 *   3. Poll `/health` every 500ms up to 8s. Return success the moment
 *      it answers. If the child exits before that (port in use,
 *      missing api key, etc.), return its exit code so the renderer
 *      can surface a useful message.
 *
 * Concurrent ensure() calls share a single in-flight promise so we
 * don't spawn multiple gbrain processes if SettingsBrainConfig and
 * SettingsBrain both probe on mount.
 */

import { spawn } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { mergedEnv } from "./provider-env"

const DEFAULT_PORT = 3131
const PROBE_TIMEOUT_MS = 2_000
const STARTUP_TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 500

/**
 * Resolve a usable `gbrain` binary path. Returns null when gbrain is
 * not installed (binary not found in any of the well-known locations).
 *
 * The previous fallback of returning the bare string "gbrain" let PATH
 * resolution paper over the difference between "missing binary" and
 * "binary exists but server is stopped", which the onboarding UI now
 * needs to distinguish so it can show the right next-step button.
 */
function findGBrainBinary(): string | null {
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
  return null
}

async function probeHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return false
    const body = (await res.json()) as Partial<{
      status: string
      version: string
    }>
    // Identity check matches the GBrainClient.health() rules — refuse
    // generic JSON responders that happen to share the port.
    return body?.status === "ok" && typeof body?.version === "string"
  } catch {
    return false
  }
}

export interface EnsureResult {
  ok: boolean
  /** True iff we spawned a new gbrain process this call. */
  started: boolean
  /** True iff the first probe already succeeded; no spawn happened. */
  alreadyRunning: boolean
  /** Absolute path of the binary, or null if gbrain is not installed. */
  binary: string | null
  /** PID of the spawned child, when we spawned one. */
  pid?: number
  /** Human-readable failure reason; absent on success. */
  error?: string
}

/**
 * Read-only "is gbrain installed anywhere?" helper. Exposed separately
 * so the renderer can render the not-installed branch without spawning
 * anything.
 */
export function locateGBrainBinary(): string | null {
  return findGBrainBinary()
}

let inflight: Promise<EnsureResult> | null = null

export function ensureGBrainServeHttp(
  port: number = DEFAULT_PORT,
): Promise<EnsureResult> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      return await runEnsure(port)
    } finally {
      // Clear the in-flight slot whether we succeeded or not — a later
      // call (e.g. user clicked Test again) should re-probe and retry.
      inflight = null
    }
  })()
  return inflight
}

/**
 * Force-restart `gbrain serve --http`: locate whatever process is
 * listening on `port` (could be one we spawned, could be one the user
 * started manually before launching hermes-x), terminate it, then run
 * the usual ensure path to spawn a fresh instance.
 *
 * Why this exists: gbrain holds its PGLite database file open at startup.
 * If the brain on disk is recovered/swapped/migrated while serve is
 * running, the server keeps using the old handle — auth tokens minted
 * via CLI go into the *new* brain, but serve still validates against the
 * old one, producing 401s on freshly-created tokens. The user has no
 * obvious way out without an in-app restart button.
 *
 * Implementation: uses `lsof` to find the listening pid, so it works on
 * processes we don't have a handle for (the original spawn was detached
 * and unref'd, plus we may not have started it at all). Unix-only —
 * matches the implicit platform constraint of `findGBrainBinary` above.
 */
export async function restartGBrainServeHttp(
  port: number = DEFAULT_PORT,
): Promise<EnsureResult> {
  // Any in-flight ensure() is operating against the OLD process; clearing
  // the slot prevents the post-kill ensure from returning that stale
  // promise. The orphaned one will resolve with whatever its poll loop
  // sees (probably a failure once we kill the process) but won't be
  // observed by anyone.
  inflight = null
  const pid = await findListenerPid(port)
  if (pid !== null) await killAndWait(pid, 4_000)
  return ensureGBrainServeHttp(port)
}

/**
 * Locate the TCP listener on `port` via `lsof -ti :PORT -sTCP:LISTEN`.
 * Returns null if nothing is listening (or lsof itself isn't available).
 * Restricting to LISTEN state filters out any clients that happen to
 * have a connection open on the same port.
 */
async function findListenerPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    let out = ""
    try {
      const child = spawn("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"])
      child.stdout?.on("data", (d) => {
        out += String(d)
      })
      child.on("error", () => resolve(null))
      child.on("exit", () => {
        const first = out.trim().split(/\s+/)[0]
        const pid = parseInt(first ?? "", 10)
        resolve(Number.isFinite(pid) && pid > 0 ? pid : null)
      })
    } catch {
      resolve(null)
    }
  })
}

/**
 * SIGTERM the process, poll for exit via `kill(pid, 0)`, escalate to
 * SIGKILL if it doesn't yield. Returns true on death, false if the
 * signal couldn't be delivered at all.
 */
async function killAndWait(pid: number, timeoutMs: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM")
  } catch (e) {
    // ESRCH = already gone; that's success for our purposes.
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return true
    return false
  }
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      // Signal 0 = liveness check, no actual signal delivered.
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return true
      return false
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  // Timed out on TERM — escalate. Best-effort; we don't wait again.
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    /* swallow */
  }
  return true
}

async function runEnsure(port: number): Promise<EnsureResult> {
  const binary = findGBrainBinary()

  if (await probeHealth(port)) {
    return { ok: true, started: false, alreadyRunning: true, binary }
  }

  if (binary === null) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary: null,
      error: "gbrain binary not found — install gbrain first.",
    }
  }

  let env: NodeJS.ProcessEnv
  try {
    env = await mergedEnv(process.env)
  } catch (e) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary,
      error: `failed to load provider env overrides: ${(e as Error).message ?? String(e)}`,
    }
  }

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(binary, ["serve", "--http", "--port", String(port)], {
      detached: true,
      // We deliberately drop stderr/stdout — keeping them piped would
      // require draining them forever in the main process, defeating the
      // "detached, outlives the desktop" point. gbrain logs to ~/.gbrain
      // by default; that's where the user looks if they need diagnostics.
      stdio: "ignore",
      env,
    })
  } catch (e) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary,
      error: (e as Error).message ?? String(e),
    }
  }

  // Capture early exit (crash before HTTP ever came up). We need this
  // BEFORE unref so the listener stays bound long enough to catch the
  // event; Node delivers exit even after unref though, so it's fine.
  let earlyExit: number | null = null
  let spawnError: string | null = null
  child.on("exit", (code) => {
    earlyExit = code ?? -1
  })
  child.on("error", (err: Error) => {
    spawnError = err.message ?? String(err)
  })

  const pid = child.pid
  child.unref()

  const startedAt = Date.now()
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (spawnError) {
      return {
        ok: false,
        started: false,
        alreadyRunning: false,
        binary,
        pid,
        error: spawnError,
      }
    }
    if (earlyExit !== null) {
      return {
        ok: false,
        started: false,
        alreadyRunning: false,
        binary,
        pid,
        error: `gbrain exited with code ${earlyExit}. Check ~/.gbrain logs.`,
      }
    }
    if (await probeHealth(port)) {
      return { ok: true, started: true, alreadyRunning: false, binary, pid }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  return {
    ok: false,
    started: true,
    alreadyRunning: false,
    binary,
    pid,
    error: `gbrain serve --http did not become ready within ${STARTUP_TIMEOUT_MS}ms`,
  }
}
