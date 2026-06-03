// packages/extension-host/src/renderer/discover.ts
import type { ExtensionManifest, RendererModule } from "@hermes-x/extension-api"
import { validateManifest } from "../main/discover"

/**
 * Compile-time discovery. Vite expands the glob at build time and the
 * generated map is { "/abs/path/manifest.json": () => import(...) }.
 *
 * We accept the glob result as an opaque module map so this module can be
 * unit-tested in node without Vite.
 */
export type RawManifestModule = () => Promise<{ default: unknown }>
export type RawRendererModule = () => Promise<RendererModule>

export interface DiscoveryInput {
  manifestModules: Record<string, RawManifestModule>
  rendererModules: Record<string, RawRendererModule>
  i18nModules: Record<string, () => Promise<{ default: Record<string, string> }>>
}

export interface DiscoveredExtension {
  manifest: ExtensionManifest
  loadRenderer?: () => Promise<RendererModule>
  loadI18n: (locale: "en" | "zh-CN") => Promise<Record<string, string> | null>
}

/**
 * Extract the extension directory id from a full glob key.
 * Example key: "/abs/repo/extensions/knowledge-base/manifest.json"
 * → "knowledge-base"
 */
function extractDirId(globKey: string): string {
  const m = globKey.match(/\/extensions\/([^/]+)\//)
  return m ? m[1]! : globKey
}

export async function discoverRendererExtensions(
  input: DiscoveryInput,
): Promise<{ extensions: DiscoveredExtension[]; failed: Array<{ key: string; error: string }> }> {
  const failed: Array<{ key: string; error: string }> = []
  const extensions: DiscoveredExtension[] = []

  for (const [manifestKey, load] of Object.entries(input.manifestModules)) {
    let manifest: ExtensionManifest
    try {
      const mod = await load()
      const v = validateManifest(mod.default)
      if (!v.ok) {
        failed.push({ key: manifestKey, error: v.error })
        continue
      }
      manifest = v.manifest
    } catch (e) {
      failed.push({ key: manifestKey, error: e instanceof Error ? e.message : String(e) })
      continue
    }

    const dirId = extractDirId(manifestKey)
    const rendererKey = Object.keys(input.rendererModules).find((k) =>
      k.includes(`/extensions/${dirId}/`),
    )
    const i18nKeyFor = (locale: "en" | "zh-CN") =>
      Object.keys(input.i18nModules).find(
        (k) => k.includes(`/extensions/${dirId}/`) && k.endsWith(`/${locale}.json`),
      )

    extensions.push({
      manifest,
      loadRenderer: rendererKey ? input.rendererModules[rendererKey] : undefined,
      loadI18n: async (locale) => {
        const key = i18nKeyFor(locale)
        if (!key) return null
        try {
          const m = await input.i18nModules[key]!()
          return m.default
        } catch {
          return null
        }
      },
    })
  }

  return { extensions, failed }
}
