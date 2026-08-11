import type { ExtensionManifest } from "@amiba/extension-api"

export type ExtensionRegistrySource = "marketplace" | "local" | "bundled"

export type ExtensionRegistryStatus =
  | "registered"
  | "loaded"
  | "failed"
  | "disabled"
  | "incompatible"

/**
 * The persisted registry entry enriched with discovery and runtime state.
 * `manifest` is optional because a broken registration must still be visible
 * and removable when its directory or manifest can no longer be read.
 */
export interface ExtensionRegistryItem {
  id: string
  source: ExtensionRegistrySource
  path: string
  version?: string
  disabled: boolean
  status: ExtensionRegistryStatus
  error?: string
  manifest?: ExtensionManifest
}
