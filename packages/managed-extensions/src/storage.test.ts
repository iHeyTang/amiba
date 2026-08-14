import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { writeJsonAtomic } from "./storage"

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("writeJsonAtomic", () => {
  it("uses distinct temporary files for writes started in the same millisecond", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-managed-extensions-storage-"))
    roots.push(root)
    const destination = join(root, "state.json")
    vi.spyOn(Date, "now").mockReturnValue(1_786_629_396_047)

    await expect(Promise.all([
      writeJsonAtomic(destination, { write: 1 }),
      writeJsonAtomic(destination, { write: 2 }),
    ])).resolves.toHaveLength(2)

    const stored = JSON.parse(await readFile(destination, "utf8")) as { write: number }
    expect([1, 2]).toContain(stored.write)
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })
})
