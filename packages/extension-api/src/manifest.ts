/**
 * Static, build-time-readable description of an extension. Parsed before
 * any extension code is loaded, so loader can still render contributes
 * (main panel, settings tab) for an extension whose entry crashed.
 */
export interface ExtensionManifest {
  /** Reverse-DNS id, used to namespace ipc / settings / storage / i18n. */
  id: string
  /** Human display name (untranslated; the i18n table holds translations). */
  name: string
  /** Semver — must match `package.json`. */
  version: string
  /** Minimum host extension-API level this extension requires (integer ≥ 1). Absent ⇒ 1. */
  apiVersion?: number
  /** Host version constraint. Phase 1: read but not enforced. */
  engines?: { "amiba"?: string }
  /** Relative bundle paths. Only main remains; renderer bundles are gone. */
  entries: {
    main?: string
  }
  /** Static contribution declarations. Loader registers them whether or not activate runs. */
  contributes?: ManifestContributes
  /** Hermes-agent plugin dependencies. */
  hermesPlugins?: Array<{
    id: string
    version?: string
    required?: boolean
  }>
  /** Permission tokens declared by the extension. Phase 1: not enforced. */
  permissions?: Permission[]
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
