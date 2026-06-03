/**
 * IPC bridge for gbrain operations.
 *
 * Exposes three channels:
 *   - `gbrain:health`         — unauthenticated health check (GET /health)
 *   - `gbrain:call`           — authenticated MCP tool call (POST /mcp)
 *   - `gbrain:providers:list` — `gbrain providers list` CLI subprocess
 *
 * The renderer calls these via `window.hermes.gbrain.*` (see preload).
 * Connection config (baseUrl, token) is read from shared storage so
 * changes in the Settings UI take effect without restarting the app.
 *
 * Note: file-plane config (`~/.gbrain/config.json`) editing was removed
 * — env vars (or `gbrain config set` for DB plane) cover every provider
 * uniformly, while file plane only ever wired up 3 hardcoded keys. The
 * GUI now points users at env vars instead.
 */

import { ipcMain } from "electron"
import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_STORAGE_KEY,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"

import { GBrainClient, type GBrainHealthResult } from "./client"
import { runProvidersList } from "./cli"
import { ensureGBrainServeHttp, restartGBrainServeHttp } from "./launcher"
import { mainStore } from "../storage"
import { runProvidersEnv } from "./recipe-schema"
import {
  listOverrideKeys,
  setOverride,
  unsetOverride,
} from "./provider-env"

let client: GBrainClient | null = null

/**
 * Read current config from storage and ensure the client is configured.
 *
 * Storage with no saved URL falls back to `BRAIN_DEFAULT_URL` — that's
 * what gbrain's own `serve --http` listens on by default
 * (`http://127.0.0.1:3131`), so a freshly-installed user with gbrain
 * already running connects automatically without ever opening the
 * advanced form. If gbrain isn't running, downstream `fetch` will fail
 * and the renderer surfaces a connection error / shows the tutorial.
 */
async function getClient(): Promise<GBrainClient> {
  const stored = await mainStore.get([
    BRAIN_URL_STORAGE_KEY,
    BRAIN_TOKEN_STORAGE_KEY,
  ])
  const url =
    typeof stored[BRAIN_URL_STORAGE_KEY] === "string"
      ? (stored[BRAIN_URL_STORAGE_KEY] as string).trim()
      : ""
  const token =
    typeof stored[BRAIN_TOKEN_STORAGE_KEY] === "string"
      ? (stored[BRAIN_TOKEN_STORAGE_KEY] as string).trim()
      : ""

  const baseUrl = url || BRAIN_DEFAULT_URL

  if (!client) {
    client = new GBrainClient({ baseUrl, token })
  } else {
    client.configure({ baseUrl, token })
  }
  return client
}

export function registerGBrainHandlers(): void {
  // Health check — doesn't need auth, just needs the URL
  ipcMain.handle(
    "gbrain:health",
    async (): Promise<GBrainHealthResult | null> => {
      const c = await getClient()
      return c.health()
    },
  )

  // Generic MCP tool call
  ipcMain.handle(
    "gbrain:call",
    async (
      _event,
      { tool, args }: { tool: string; args?: Record<string, unknown> },
    ): Promise<unknown> => {
      const c = await getClient()
      return c.call(tool, args)
    },
  )

  // Authenticated probe — distinct from `gbrain:health` because /health
  // is unauthenticated, so the renderer needs a separate channel to
  // surface "token rejected" without trying to do a full search/list.
  // Returns a tagged result instead of throwing so the renderer can map
  // "invalid-token" to a friendlier message.
  ipcMain.handle(
    "gbrain:verify-auth",
    async (): Promise<
      | { ok: true }
      | { ok: false; reason: "invalid-token" | "other"; error: string }
    > => {
      const c = await getClient()
      try {
        await c.verifyAuth()
        return { ok: true }
      } catch (e) {
        const error = (e as Error).message ?? String(e)
        const isAuth = /HTTP 401|invalid_token|Invalid token|Unauthorized/i.test(error)
        return { ok: false, reason: isAuth ? "invalid-token" : "other", error }
      }
    },
  )

  // Dynamic provider list — shells out to `gbrain providers list`. The
  // CLI runs without a DB connection, so this works even when gbrain
  // serve isn't up. Returns `{ ok, providers, binary, error? }`.
  ipcMain.handle("gbrain:providers:list", () => runProvidersList())

  // Fetch provider env-var schema for a specific provider ID.
  ipcMain.handle("gbrain:providers:env", async (_e, id: unknown) => {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, binary: "", error: "id required" }
    }
    return runProvidersEnv(id)
  })

  // List all provider env-var overrides currently saved in storage.
  ipcMain.handle("gbrain:providers:overrides:list", async () => {
    try {
      return { ok: true, overrides: await listOverrideKeys() }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  })

  // Set (create or update) a single env-var override for a provider.
  ipcMain.handle(
    "gbrain:providers:overrides:set",
    async (
      _e,
      payload: { providerId?: string; envKey?: string; value?: string },
    ) => {
      const { providerId, envKey, value } = payload ?? {}
      if (!providerId || !envKey || typeof value !== "string") {
        return { ok: false, error: "providerId, envKey, value required" }
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(envKey)) {
        return { ok: false, error: `invalid envKey: ${envKey}` }
      }
      try {
        await setOverride(providerId, envKey, value)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message ?? String(e) }
      }
    },
  )

  // Remove a single env-var override for a provider.
  ipcMain.handle(
    "gbrain:providers:overrides:unset",
    async (_e, payload: { providerId?: string; envKey?: string }) => {
      const { providerId, envKey } = payload ?? {}
      if (!providerId || !envKey) {
        return { ok: false, error: "providerId, envKey required" }
      }
      try {
        await unsetOverride(providerId, envKey)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message ?? String(e) }
      }
    },
  )

  // Ensure `gbrain serve --http` is running. Probes /health first; only
  // spawns when needed. Detached + unref'd so the server outlives the
  // desktop process. Concurrent callers share a single in-flight spawn.
  ipcMain.handle("gbrain:launcher:ensure", () => ensureGBrainServeHttp())

  // Hard-restart the gbrain server — kills whatever's listening on the
  // port and respawns. Exposed because gbrain's PGLite handle survives
  // brain-on-disk changes (recovery, migration), so newly-minted tokens
  // can be invisible to a long-running serve. /health alone can't detect
  // this; only a restart can resync.
  ipcMain.handle("gbrain:launcher:restart", () => restartGBrainServeHttp())
}

/**
 * Kick off a best-effort auto-start of `gbrain serve --http` at app
 * boot. We deliberately don't await this — we just want the server
 * warming up in the background so by the time the user navigates to
 * the Brain workspace it's ready. Failures (gbrain not installed, port
 * in use, etc.) are silent here; the renderer's mount-time ensure()
 * call surfaces them with a proper error message.
 */
export function autoStartGBrainServeHttp(): void {
  void ensureGBrainServeHttp().catch(() => {
    // Swallow — boot path can't show UI yet, and the renderer will
    // re-attempt with proper error reporting when settings/Brain
    // mounts.
  })
}
