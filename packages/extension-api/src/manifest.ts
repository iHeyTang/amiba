/** Identity shared by installed and AI-managed Extensions. */
export interface ExtensionIdentity {
  /** Reverse-DNS id, used to namespace ipc / settings / storage / i18n. */
  id: string
  /** Human display name (untranslated; the i18n table holds translations). */
  name: string
  description?: string
  icon?: string
}

export type ExtensionSource =
  | "bundled"
  | "marketplace"
  | "local"
  | "personal-managed"

/**
 * Static, build-time-readable description of an extension. Parsed before
 * any extension code is loaded, so loader can still render contributes
 * (main panel, settings tab) for an extension whose entry crashed.
 */
export interface ExtensionManifest extends ExtensionIdentity {
  /** Semver — must match `package.json`. */
  version: string
  /** Minimum host extension-API level this extension requires (integer ≥ 1). Absent ⇒ 1. */
  apiVersion?: number
  /** Host version constraint. Phase 1: read but not enforced. */
  engines?: { amiba?: string }
  /** Relative bundle paths. Only main remains; renderer bundles are gone. */
  entries: {
    main?: string
  }
  /** Static contribution declarations. Loader registers them whether or not activate runs. */
  contributes?: ManifestContributes
  /** Composer @-mention projections owned by this Extension. */
  mentions?: ManifestMentionContribution[]
  /** Hermes-agent plugin dependencies. */
  hermesPlugins?: Array<{
    id: string
    version?: string
    required?: boolean
  }>
  /** Permission tokens declared by the extension. Phase 1: not enforced. */
  permissions?: Permission[]
}

/**
 * Capabilities contributed by one Extension. ``main`` is the technical name
 * for the user-facing small-app surface; it is not a second lifecycle root.
 */
export type ExtensionContributionKind =
  | "main"
  | "settings"
  | "mentions"
  | "hermes-plugin"
  | "tools"
  | "resources"

/** Canonical catalog projection regardless of the storage/runtime adapter. */
export interface ExtensionCatalogEntry extends ExtensionIdentity {
  source: ExtensionSource
  contributions: ExtensionContributionKind[]
}

export function extensionManifestContributions(
  manifest?: Pick<ExtensionManifest, "contributes" | "mentions" | "hermesPlugins">,
): ExtensionContributionKind[] {
  if (!manifest) return []
  const contributions: ExtensionContributionKind[] = []
  if (manifest.contributes?.main) contributions.push("main")
  if (manifest.contributes?.settings) contributions.push("settings")
  if (manifest.mentions?.length) contributions.push("mentions")
  if (manifest.hermesPlugins?.length) contributions.push("hermes-plugin")
  return contributions
}

/**
 * Projects one MCP Resource family into the composer's @ menu.
 *
 * The Extension remains the lifecycle root: this declaration is metadata for the
 * Amiba host, while discovery, search and reads stay on the referenced MCP
 * provider. A mention is therefore an Extension capability, never an installable
 * package of its own.
 */
export interface ManifestMentionContribution {
  /** Stable id within the Extension. */
  id: string
  /** Alias of the MCP provider declared by the Extension. */
  provider: string
  /** User-facing category name. */
  label: string
  /** Optional icon name understood by the host. */
  icon?: string
  /** MCP Resource URI template used to read the selected item. */
  resourceUriTemplate?: string
  /** MCP tool used to search or list candidates. */
  searchTool?: string
}

export interface ManifestContributes {
  /**
   * The ActivityBar icon AND its corresponding main-panel page.
   * Clicking the icon enters this page. extensionId doubles as the activity item id.
   */
  main?: {
    /** Lucide icon name. */
    icon: string
    /** Locale → display text. */
    labels: Record<string, string>
    /** Relative path to the HTML page. */
    view: string
    order?: number
  }
  /**
   * A row under Settings → EXTENSIONS sidebar group, plus the page
   * rendered when clicked. extensionId doubles as the settings tab id.
   */
  settings?: {
    /** Optional lucide icon name. */
    icon?: string
    /** Locale → display text. */
    labels: Record<string, string>
    /** Relative path to the HTML page. */
    view: string
    order?: number
  }
}

export type Permission =
  | "ipc"
  | "settings"
  | "storage"
  | "i18n"
  | "lifecycle.boot"
  | "hermes.callTool"
  | "hermes.backplane"
