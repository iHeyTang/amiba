// packages/extension-host/src/main/registry-store.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type ExtensionSource = "marketplace" | "local" | "bundled"

export interface RegistryEntry {
  id: string
  source: ExtensionSource
  path: string  // absolute path to extension root
  version?: string
  sha256?: string
  installedAt?: string  // ISO 8601
  addedAt?: string      // ISO 8601 (local entries)
  disabled?: boolean
}

export interface Registry {
  version: 1
  entries: RegistryEntry[]
}

const EMPTY: Registry = { version: 1, entries: [] }

export function loadRegistry(registryPath: string): Registry {
  if (!existsSync(registryPath)) return { ...EMPTY, entries: [...EMPTY.entries] }
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as Partial<Registry>
    return {
      version: 1,
      entries: Array.isArray(raw.entries) ? raw.entries.filter(isValidEntry) : [],
    }
  } catch {
    return { ...EMPTY, entries: [...EMPTY.entries] }
  }
}

function isValidEntry(e: unknown): e is RegistryEntry {
  if (!e || typeof e !== "object") return false
  const r = e as Partial<RegistryEntry>
  return (
    typeof r.id === "string" &&
    typeof r.path === "string" &&
    (r.source === "marketplace" || r.source === "local" || r.source === "bundled")
  )
}

/**
 * Atomic write: tmp + rename. Cheap protection against power-loss corruption.
 */
export function saveRegistry(registryPath: string, registry: Registry): void {
  mkdirSync(dirname(registryPath), { recursive: true })
  const tmp = `${registryPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8")
  renameSync(tmp, registryPath)
}

export function addEntry(registryPath: string, entry: RegistryEntry): Registry {
  const reg = loadRegistry(registryPath)
  const without = reg.entries.filter((e) => e.id !== entry.id)
  const next: Registry = { version: 1, entries: [...without, entry] }
  saveRegistry(registryPath, next)
  return next
}

export function removeEntry(registryPath: string, id: string): Registry {
  const reg = loadRegistry(registryPath)
  const next: Registry = { version: 1, entries: reg.entries.filter((e) => e.id !== id) }
  saveRegistry(registryPath, next)
  return next
}

export function findEntry(registryPath: string, id: string): RegistryEntry | undefined {
  return loadRegistry(registryPath).entries.find((e) => e.id === id)
}
