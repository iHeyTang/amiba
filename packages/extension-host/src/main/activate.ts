import type {
  ExtensionManifest,
  MainHost,
  MainModule,
} from "@hermes-x/extension-api"

export interface ActivateOptions {
  manifests: ExtensionManifest[]
  loadMain: (extensionId: string) => Promise<MainModule>
  makeHost: (extensionId: string) => MainHost
  timeoutMs?: number
}

export interface ActivateResult {
  loaded: Array<{ id: string }>
  failed: Array<{ id: string; error: string }>
}

const DEFAULT_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`activate timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      },
    )
  })
}

export async function activateMainExtensions(
  opts: ActivateOptions,
): Promise<ActivateResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const loaded: ActivateResult["loaded"] = []
  const failed: ActivateResult["failed"] = []

  for (const manifest of opts.manifests) {
    if (!manifest.entries.main) {
      loaded.push({ id: manifest.id })
      continue
    }
    try {
      const mod = await opts.loadMain(manifest.id)
      const host = opts.makeHost(manifest.id)
      await withTimeout(Promise.resolve(mod.activate(host)), timeoutMs)
      loaded.push({ id: manifest.id })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failed.push({ id: manifest.id, error })
    }
  }

  return { loaded, failed }
}
