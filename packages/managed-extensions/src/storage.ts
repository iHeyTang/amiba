import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

export async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

export async function listJsonFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export function extensionRoot(root: string, extensionId: string): string {
  return join(root, extensionId)
}

export function statePath(root: string, extensionId: string): string {
  return join(extensionRoot(root, extensionId), "state.json")
}

export function revisionPath(root: string, extensionId: string, revisionId: string): string {
  return join(extensionRoot(root, extensionId), "revisions", `${revisionId}.json`)
}

export function draftPath(root: string, extensionId: string, draftId: string): string {
  return join(extensionRoot(root, extensionId), "drafts", `${draftId}.json`)
}

export function bundlePath(root: string, extensionId: string, bundleHash: string): string {
  return join(extensionRoot(root, extensionId), "bundles", bundleHash)
}

export function outputPath(root: string, extensionId: string, outputId: string): string {
  return join(extensionRoot(root, extensionId), "outputs", `${outputId}.json`)
}

export function presetPath(root: string, extensionId: string, presetId: string): string {
  return join(extensionRoot(root, extensionId), "presets", `${presetId}.json`)
}
