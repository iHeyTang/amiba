// packages/extension-host/src/main/storage-fs.ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

function rootDir(): string {
  return join(app.getPath("userData"), "extensions-storage")
}

function pathFor(extensionId: string, key: string): string {
  // Defensive: never allow path traversal in key.
  const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_")
  return join(rootDir(), extensionId, `${safe}.json`)
}

export function createExtensionStorage() {
  return {
    async get<T>(
      extensionId: string,
      key: string,
      fallback: T,
    ): Promise<T> {
      try {
        const raw = await readFile(pathFor(extensionId, key), "utf8")
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    async set(
      extensionId: string,
      key: string,
      value: unknown,
    ): Promise<void> {
      const file = pathFor(extensionId, key)
      await mkdir(join(rootDir(), extensionId), { recursive: true })
      await writeFile(file, JSON.stringify(value), "utf8")
    },
  }
}
