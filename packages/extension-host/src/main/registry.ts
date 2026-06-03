import type { ExtensionManifest } from "@hermes-x/extension-api"

export interface RuntimeExtension {
  id: string
  manifest: ExtensionManifest
  status: "loaded" | "failed" | "disabled"
  error?: string
}

export function createExtensionRegistry() {
  const byId = new Map<string, RuntimeExtension>()
  return {
    set(ext: RuntimeExtension) {
      byId.set(ext.id, ext)
    },
    get(id: string): RuntimeExtension | undefined {
      return byId.get(id)
    },
    list(): RuntimeExtension[] {
      return [...byId.values()]
    },
  }
}
