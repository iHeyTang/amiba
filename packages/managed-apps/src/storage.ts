import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
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
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(tmp, path)
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

export function appRoot(root: string, appId: string): string {
  return join(root, appId)
}

export function statePath(root: string, appId: string): string {
  return join(appRoot(root, appId), "state.json")
}

export function revisionPath(root: string, appId: string, revisionId: string): string {
  return join(appRoot(root, appId), "revisions", `${revisionId}.json`)
}

export function draftPath(root: string, appId: string, draftId: string): string {
  return join(appRoot(root, appId), "drafts", `${draftId}.json`)
}

export function bundlePath(root: string, appId: string, bundleHash: string): string {
  return join(appRoot(root, appId), "bundles", bundleHash)
}

export function outputPath(root: string, appId: string, outputId: string): string {
  return join(appRoot(root, appId), "outputs", `${outputId}.json`)
}

export function presetPath(root: string, appId: string, presetId: string): string {
  return join(appRoot(root, appId), "presets", `${presetId}.json`)
}
