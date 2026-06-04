/**
 * Static, build-time-readable description of an extension. Parsed before
 * any extension code is loaded, so loader can still render contributes
 * (activityBar item, settings tab) for an extension whose entry crashed.
 */
export interface ExtensionManifest {
  /** Reverse-DNS id, used to namespace ipc / settings / storage / i18n. */
  id: string
  /** Human display name (untranslated; the i18n table holds translations). */
  name: string
  /** Semver — must match `package.json`. */
  version: string
  /** Host version constraint. Phase 1: read but not enforced. */
  engines?: { "hermes-x"?: string }
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
  activityBar?: Array<{
    id: string
    /** Lucide icon name. */
    icon: string
    /** Locale → display text. */
    labels: Record<string, string>
    order?: number
  }>
  sidebarViews?: Array<{
    id: string
    /** "activityBar:<id>" — view is mounted when matching activity item is selected. */
    anchor: string
    /** Relative path to the HTML page, e.g. "ui/sidebar.html". */
    view: string
  }>
  settingsTabs?: Array<{
    id: string
    /** Locale → display text. */
    labels: Record<string, string>
    /** Optional lucide icon name. */
    icon?: string
    /** Relative path to the HTML page. */
    view: string
    order?: number
  }>
  composerHints?: Array<{
    id: string
    /** Relative path to the HTML page. */
    view: string
  }>
}

export type Permission =
  | "ipc"
  | "settings"
  | "storage"
  | "i18n"
  | "lifecycle.boot"
  | "hermes.callTool"
