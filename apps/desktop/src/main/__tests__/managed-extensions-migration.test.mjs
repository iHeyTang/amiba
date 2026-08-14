import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { migrateLegacyManagedExtensionsRoot } from "../managed-extensions-migration.ts"

test("renames the former managed Extension root when the canonical root is absent", async () => {
  const userData = await mkdtemp(join(tmpdir(), "amiba-extension-migration-"))
  const legacyExtension = join(userData, "managed-apps", "io.amiba.personal.saved")
  await mkdir(legacyExtension, { recursive: true })
  await writeFile(join(legacyExtension, "state.json"), "saved", "utf8")

  const result = await migrateLegacyManagedExtensionsRoot(userData)

  assert.equal(result.migratedRoot, true)
  assert.equal(
    await readFile(
      join(userData, "managed-extensions", "io.amiba.personal.saved", "state.json"),
      "utf8",
    ),
    "saved",
  )
})

test("merges only non-conflicting entries and preserves legacy conflicts", async () => {
  const userData = await mkdtemp(join(tmpdir(), "amiba-extension-migration-"))
  const legacyRoot = join(userData, "managed-apps")
  const canonicalRoot = join(userData, "managed-extensions")
  await mkdir(join(legacyRoot, "io.amiba.personal.old"), { recursive: true })
  await mkdir(join(legacyRoot, "io.amiba.personal.same"), { recursive: true })
  await mkdir(join(canonicalRoot, "io.amiba.personal.same"), { recursive: true })
  await writeFile(join(legacyRoot, "io.amiba.personal.same", "state.json"), "legacy", "utf8")
  await writeFile(join(canonicalRoot, "io.amiba.personal.same", "state.json"), "canonical", "utf8")

  const result = await migrateLegacyManagedExtensionsRoot(userData)

  assert.deepEqual(result.movedEntries, ["io.amiba.personal.old"])
  assert.deepEqual(result.conflicts, ["io.amiba.personal.same"])
  assert.equal(
    await readFile(join(canonicalRoot, "io.amiba.personal.same", "state.json"), "utf8"),
    "canonical",
  )
  assert.equal(
    await readFile(join(legacyRoot, "io.amiba.personal.same", "state.json"), "utf8"),
    "legacy",
  )
})
