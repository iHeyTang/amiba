// apps/cli/src/lib/registry.ts
//
// Standalone registry CRUD for the CLI. Cannot import from
// @amiba/extension-host/main because that module pulls in Electron deps.
// Duplicates the ~40-LOC core from packages/extension-host/src/main/registry-store.ts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir, platform } from "node:os"
import { resolve } from "node:path"

const APP_NAME = "Hermes"

export interface RegistryEntry {
  id: string
  source: "marketplace" | "local"
  path: string
  version?: string
  sha256?: string
  installedAt?: string
  addedAt?: string
  disabled?: boolean
}

export interface Registry {
  version: 1
  entries: RegistryEntry[]
}

const EMPTY: Registry = { version: 1, entries: [] }

function isValidEntry(e: unknown): e is RegistryEntry {
  if (!e || typeof e !== "object") return false
  const r = e as Partial<RegistryEntry>
  return (
    typeof r.id === "string" &&
    typeof r.path === "string" &&
    (r.source === "marketplace" || r.source === "local")
  )
}

function loadRegistry(registryPath: string): Registry {
  if (!existsSync(registryPath)) return { ...EMPTY, entries: [] }
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as Partial<Registry>
    return {
      version: 1,
      entries: Array.isArray(raw.entries) ? raw.entries.filter(isValidEntry) : [],
    }
  } catch {
    return { ...EMPTY, entries: [] }
  }
}

function saveRegistry(registryPath: string, registry: Registry): void {
  mkdirSync(dirname(registryPath), { recursive: true })
  const tmp = `${registryPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8")
  renameSync(tmp, registryPath)
}

/**
 * Resolve the path to the extensions-registry.json file.
 * Mirrors the desktop's getRegistryPath() logic but without Electron.
 */
export function resolveRegistryPath(): string {
  const home = homedir()
  const plat = platform()
  if (plat === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME, "extensions-registry.json")
  }
  if (plat === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
    return join(appData, APP_NAME, "extensions-registry.json")
  }
  // linux + others
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), APP_NAME, "extensions-registry.json")
}

/**
 * Find an existing entry by id.
 */
export function findLocalEntry(registryPath: string, id: string): RegistryEntry | undefined {
  return loadRegistry(registryPath).entries.find((e) => e.id === id)
}

/**
 * Register a marketplace install. Refuses to overwrite an existing entry —
 * caller must uninstall first. Returns the new entry.
 */
export function addMarketplaceEntry(
  registryPath: string,
  args: { id: string; absolutePath: string; version: string; sha256?: string },
): RegistryEntry {
  const absPath = resolve(args.absolutePath)
  const reg = loadRegistry(registryPath)
  const existing = reg.entries.find((e) => e.id === args.id)
  if (existing) {
    throw new Error(
      `Extension "${args.id}" is already registered (source: ${existing.source}, path: ${existing.path}).\n` +
        `Uninstall first via the desktop UI before installing a new version.`,
    )
  }
  const entry: RegistryEntry = {
    id: args.id,
    source: "marketplace",
    path: absPath,
    version: args.version,
    sha256: args.sha256,
    installedAt: new Date().toISOString(),
  }
  saveRegistry(registryPath, { version: 1, entries: [...reg.entries, entry] })
  return entry
}

/**
 * Add a local entry pointing at `absolutePath`. If an entry with this id
 * already exists at a DIFFERENT path, throws with a clear error.
 * Idempotent for same-path re-registration.
 */
export function addLocalEntry(registryPath: string, id: string, absolutePath: string): void {
  const absPath = resolve(absolutePath)
  const reg = loadRegistry(registryPath)
  const existing = reg.entries.find((e) => e.id === id)
  if (existing && existing.path !== absPath) {
    throw new Error(
      `Extension "${id}" is already registered at a different path: ${existing.path}\n` +
      `To re-register, remove the old entry first via the app or CLI uninstall.`,
    )
  }
  const without = reg.entries.filter((e) => e.id !== id)
  const next: Registry = {
    version: 1,
    entries: [
      ...without,
      {
        id,
        source: "local",
        path: absPath,
        addedAt: new Date().toISOString(),
      },
    ],
  }
  saveRegistry(registryPath, next)
}
