import type { MainActivate, MainHost } from "@hermes-x/extension-api"

import { GBrainClient, type GBrainHealthResult } from "./lib/client"
import { runProvidersList } from "./lib/cli"
import {
  ensureGBrainServeHttp,
  restartGBrainServeHttp,
  locateGBrainBinary,
} from "./lib/launcher"
import { runProvidersEnv } from "./lib/recipe-schema"
import { listOverrideKeys, setOverride, unsetOverride } from "./lib/provider-env"
import { BRAIN_DEFAULT_URL, BRAIN_URL_KEY } from "./lib/constants"

/**
 * Aggregated status used by the renderer to pick an onboarding state:
 *
 *   not-installed   binary missing entirely
 *   stopped         binary exists, /health unreachable
 *   no-provider     /health OK, but no provider is `ready=true`
 *   ready           /health OK and at least one provider is configured
 *
 * Computed in a single IPC roundtrip so the renderer doesn't have to
 * orchestrate three separate calls + their failure modes.
 */
type LifecycleStage = "not-installed" | "stopped" | "no-provider" | "ready"
interface LifecycleProbe {
  stage: LifecycleStage
  binary: string | null
  health: GBrainHealthResult | null
  providerCount: number
  readyProviderCount: number
}

let client: GBrainClient | null = null

async function getClient(host: MainHost): Promise<GBrainClient> {
  const url = (await host.settings.get<string>(BRAIN_URL_KEY, "")).trim() || BRAIN_DEFAULT_URL
  if (!client) {
    client = new GBrainClient({ baseUrl: url })
  } else {
    client.configure({ baseUrl: url })
  }
  return client
}

export const activate: MainActivate = async (host) => {
  host.ipc.expose<void, GBrainHealthResult | null>("health", async () => {
    const c = await getClient(host)
    return c.health()
  })

  host.ipc.expose<{ tool: string; args?: Record<string, unknown> }, unknown>(
    "call",
    async ({ tool, args }) => {
      const c = await getClient(host)
      return c.call(tool, args)
    },
  )

  host.ipc.expose<void, LifecycleProbe>("lifecycle.probe", async () => {
    const binary = locateGBrainBinary()
    if (binary === null) {
      return {
        stage: "not-installed",
        binary: null,
        health: null,
        providerCount: 0,
        readyProviderCount: 0,
      }
    }
    const c = await getClient(host)
    const health = await c.health()
    if (health === null) {
      return {
        stage: "stopped",
        binary,
        health: null,
        providerCount: 0,
        readyProviderCount: 0,
      }
    }
    const providers = await runProvidersList()
    const providerCount = providers.providers?.length ?? 0
    const readyProviderCount =
      providers.providers?.filter((p) => p.ready).length ?? 0
    return {
      stage: readyProviderCount > 0 ? "ready" : "no-provider",
      binary,
      health,
      providerCount,
      readyProviderCount,
    }
  })

  host.ipc.expose("providers.list", () => runProvidersList())
  host.ipc.expose<string, unknown>("providers.env", async (id) => {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, binary: "", error: "id required" }
    }
    return runProvidersEnv(id)
  })

  host.ipc.expose("providers.overrides.list", async () => {
    try {
      return { ok: true, overrides: await listOverrideKeys() }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  })

  host.ipc.expose<{ providerId: string; envKey: string; value: string }, unknown>(
    "providers.overrides.set",
    async ({ providerId, envKey, value }) => {
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

  host.ipc.expose<{ providerId: string; envKey: string }, unknown>(
    "providers.overrides.unset",
    async ({ providerId, envKey }) => {
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

  host.ipc.expose("launcher.ensure", () => ensureGBrainServeHttp())
  host.ipc.expose("launcher.restart", () => restartGBrainServeHttp())

  host.lifecycle.onBootBackground(async () => {
    try {
      await ensureGBrainServeHttp()
    } catch (e) {
      host.logger.warn("auto-start failed:", e)
    }
  })
}
