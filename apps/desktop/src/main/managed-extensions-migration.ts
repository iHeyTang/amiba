import { readdir, rename, stat } from "node:fs/promises"
import { join } from "node:path"

export interface ManagedExtensionsMigrationResult {
  migratedRoot: boolean
  movedEntries: string[]
  conflicts: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Move persisted data from the former Applets storage root without replacing
 * anything already written under the canonical Extensions root.
 */
export async function migrateLegacyManagedExtensionsRoot(
  userDataRoot: string,
): Promise<ManagedExtensionsMigrationResult> {
  // Persisted path only: keep the retired noun inside this migration boundary.
  const legacyRoot = join(userDataRoot, "managed-apps")
  const canonicalRoot = join(userDataRoot, "managed-extensions")
  const result: ManagedExtensionsMigrationResult = {
    migratedRoot: false,
    movedEntries: [],
    conflicts: [],
  }

  if (!(await exists(legacyRoot))) return result
  if (!(await exists(canonicalRoot))) {
    await rename(legacyRoot, canonicalRoot)
    result.migratedRoot = true
    return result
  }

  for (const entry of await readdir(legacyRoot, { withFileTypes: true })) {
    const legacyEntry = join(legacyRoot, entry.name)
    const canonicalEntry = join(canonicalRoot, entry.name)
    if (await exists(canonicalEntry)) {
      result.conflicts.push(entry.name)
      continue
    }
    await rename(legacyEntry, canonicalEntry)
    result.movedEntries.push(entry.name)
  }
  return result
}
