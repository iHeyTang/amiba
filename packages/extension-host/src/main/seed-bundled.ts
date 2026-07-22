// packages/extension-host/src/main/seed-bundled.ts
//
// Boot-time seeding of BUNDLED extensions — the ones that ship with the app
// (default-installed) rather than being fetched from the marketplace or
// sideloaded. The desktop main process passes the resolved root dir for each
// bundled ext (dev: sibling repo; packaged: resources/bundled-extensions/<id>),
// and we ensure a `source: "bundled"` registry entry exists and tracks the
// shipped version.
//
// Idempotent + update-aware:
//   - missing entry            → add it (seeded)
//   - version changed / moved  → rewrite path+version, PRESERVE the user's
//                                `disabled` flag (updated)
//   - same version + same path → leave untouched (skipped)
//
// A bundled root whose manifest.json is missing (e.g. a dev sibling repo that
// hasn't been built/checked out) is recorded as `failed` and skipped — never
// throws, so a partial dev setup can't block app boot.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  addEntry,
  findEntry,
  loadRegistry,
  removeEntry,
  type RegistryEntry,
} from "./registry-store"

export interface BundledExtSpec {
  /** Reverse-DNS extension id, e.g. "io.amiba.skills". */
  id: string
  /** Absolute path to the extension root (dir containing manifest.json + dist/). */
  root: string
}

export interface SeedBundledResult {
  seeded: string[]
  updated: string[]
  skipped: string[]
  failed: { id: string; error: string }[]
  /** `source: "bundled"` entries removed because the app no longer ships them. */
  pruned: string[]
}

export function seedBundledExtensions(
  registryPath: string,
  specs: BundledExtSpec[],
): SeedBundledResult {
  const result: SeedBundledResult = {
    seeded: [],
    updated: [],
    skipped: [],
    failed: [],
    pruned: [],
  }

  // Prune bundled entries the app no longer ships. Only `source: "bundled"`
  // rows are candidates — marketplace/local installs are the user's own and
  // never touched here. Without this, an id dropped from the bundled set
  // (e.g. an ext promoted to a built-in page) would linger in the registry
  // pointing at a deleted directory and surface as a dead extension.
  try {
    const shipped = new Set(specs.map((s) => s.id))
    for (const entry of loadRegistry(registryPath).entries) {
      if (entry.source === "bundled" && !shipped.has(entry.id)) {
        removeEntry(registryPath, entry.id)
        result.pruned.push(entry.id)
      }
    }
  } catch (e) {
    result.failed.push({ id: "(prune)", error: String((e as Error)?.message || e) })
  }

  for (const spec of specs) {
    try {
      const manifestPath = join(spec.root, "manifest.json")
      if (!existsSync(manifestPath)) {
        result.failed.push({
          id: spec.id,
          error: `manifest.json not found at ${spec.root} (ext not built/present?)`,
        })
        continue
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        id?: string
        version?: string
      }
      if (manifest.id && manifest.id !== spec.id) {
        result.failed.push({
          id: spec.id,
          error: `manifest id "${manifest.id}" != expected "${spec.id}"`,
        })
        continue
      }
      const version = typeof manifest.version === "string" ? manifest.version : undefined

      const existing = findEntry(registryPath, spec.id)
      if (
        existing &&
        existing.source === "bundled" &&
        existing.version === version &&
        existing.path === spec.root
      ) {
        result.skipped.push(spec.id)
        continue
      }

      const entry: RegistryEntry = {
        id: spec.id,
        source: "bundled",
        path: spec.root,
        version,
        // Preserve provenance + the user's enable/disable choice across updates.
        installedAt: existing?.installedAt ?? new Date().toISOString(),
        disabled: existing?.disabled,
      }
      addEntry(registryPath, entry)
      if (existing) result.updated.push(spec.id)
      else result.seeded.push(spec.id)
    } catch (e) {
      result.failed.push({ id: spec.id, error: String((e as Error)?.message || e) })
    }
  }

  return result
}
