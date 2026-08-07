/**
 * Single fetch entry point for the local backplane plugin
 * (`http://127.0.0.1:19394`).
 *
 * Auth: reads the user's `AMIBA_BACKPLANE_KEY` mirror from
 * `getPlatform().storage` and injects it as `Authorization: Bearer …`
 * when present. When empty, no auth header is sent — backplane accepts
 * unauthenticated requests on loopback.
 *
 * Use this for every route under `/hermes/*`, `/integrations/*`, and
 * `/v1/*` (chat completions, runs, models, approval — backplane
 * reverse-proxies those to the Hermes gateway internally).
 */

import { getPlatform } from "@amiba/platform"

import { BACKPLANE_HTTP_BASE, BACKPLANE_KEY_STORAGE_KEY } from "./config"
import {
  HermesVersionCompatibilityError,
  getHermesVersionCompatibility,
} from "./hermes-version"

const COMPATIBILITY_CACHE_MS = 30_000
let compatibilityCheckedAt = 0
let compatibilityCheck: Promise<void> | null = null

export function invalidateHermesCompatibilityCache(): void {
  compatibilityCheckedAt = 0
  compatibilityCheck = null
}

async function readBackplaneKey(): Promise<string> {
  try {
    const r = await getPlatform().storage.get(BACKPLANE_KEY_STORAGE_KEY)
    const v = r[BACKPLANE_KEY_STORAGE_KEY]
    return typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const slash = path.startsWith("/") ? "" : "/"
  return `${BACKPLANE_HTTP_BASE}${slash}${path}`
}

function compatibilityExempt(path: string, method?: string): boolean {
  if ((method || "GET").toUpperCase() === "OPTIONS") return true
  let pathname = path
  try {
    pathname = new URL(resolveUrl(path)).pathname
  } catch {
    // Keep the raw value. The actual fetch will surface an invalid URL.
  }
  return (
    pathname === "/health" ||
    pathname === "/hermes/status" ||
    pathname === "/hermes/update" ||
    pathname.startsWith("/hermes/actions/")
  )
}

async function verifyHermesCompatibility(headers: Headers): Promise<void> {
  if (Date.now() - compatibilityCheckedAt < COMPATIBILITY_CACHE_MS) return
  if (compatibilityCheck) return compatibilityCheck

  compatibilityCheck = (async () => {
    let response: Response
    try {
      response = await fetch(resolveUrl("/hermes/status"), {
        method: "GET",
        headers,
      })
    } catch {
      throw new HermesVersionCompatibilityError(
        getHermesVersionCompatibility(""),
      )
    }
    if (!response.ok) {
      throw new HermesVersionCompatibilityError(
        getHermesVersionCompatibility(""),
      )
    }
    const body = (await response.json().catch(() => null)) as
      | { version?: unknown }
      | null
    const compatibility = getHermesVersionCompatibility(body?.version)
    if (!compatibility.compatible) {
      throw new HermesVersionCompatibilityError(compatibility)
    }
    compatibilityCheckedAt = Date.now()
  })()

  try {
    await compatibilityCheck
  } finally {
    compatibilityCheck = null
  }
}

export async function backplaneFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = resolveUrl(path)
  const key = await readBackplaneKey()
  const headers = new Headers(init.headers || {})
  if (key && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${key}`)
  }
  if (!compatibilityExempt(path, init.method)) {
    await verifyHermesCompatibility(headers)
  }
  return fetch(url, { ...init, headers })
}

/**
 * Synchronous URL builder for cases where `fetch` is called from a
 * non-async context. Caller is responsible for the Authorization header.
 */
export function backplaneUrl(path: string): string {
  return resolveUrl(path)
}
