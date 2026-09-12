import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { DESKTOP_DEVELOPMENT_FILE, type DesktopDevelopmentEndpoint } from "@amiba/app-runtime/dsh-runtime"

/** Prefer a running desktop, rather than an old dev install's existing directory. */
export async function discoverDevelopmentEndpoint(homes: string[]): Promise<DesktopDevelopmentEndpoint> {
  const candidates = await Promise.all(homes.map(async home => {
    try {
      const endpoint: DesktopDevelopmentEndpoint = JSON.parse(await readFile(join(home, DESKTOP_DEVELOPMENT_FILE), "utf8"))
      const url = new URL(endpoint.url)
      if (endpoint.version !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !endpoint.token || !Number.isInteger(endpoint.pid) || endpoint.pid <= 0) return undefined
      process.kill(endpoint.pid, 0)
      const response = await fetch(new URL("/ping", url), {
        method: "POST", headers: { Authorization: `Bearer ${endpoint.token}` }, body: "{}", signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) return undefined
      const reply = await response.json() as { pid?: number }
      return reply.pid === endpoint.pid ? endpoint : undefined
    } catch { return undefined }
  }))
  const active = [...new Map(candidates.filter((candidate): candidate is DesktopDevelopmentEndpoint => candidate !== undefined).map(candidate => [candidate.url, candidate])).values()]
  if (active.length > 1) throw new Error("Multiple Amiba desktops are running. Select one with amiba --dsh-home <path> plugin dev.")
  if (!active.length) throw new Error(`Open an Amiba version that supports plugin development first. No running desktop found in: ${homes.join(", ")}`)
  return active[0]!
}
