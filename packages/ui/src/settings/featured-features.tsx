import { Globe } from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import {
  getHermesPlugins,
  setPluginEnabled,
  type HermesPlugin,
} from "@hermes-x/core"
import { useT, type MessageKey } from "@hermes-x/i18n"

import { Button, ScrollArea, Switch } from "../primitives"
import { useStartAgentTask } from "./agent-task"
import { SettingsPaneHeader } from "./SettingsPaneHeader"

/**
 * A **featured feature** is one hermes-agent plugin promoted to a first-class,
 * product-level surface. It is the answer to a deliberate design tension: a
 * thing like browser-control is *technically* just another Python plugin, but
 * *product-wise* it's a headline capability that deserves its own home in
 * Settings — and there will be more of these over time.
 *
 * So a featured plugin lives on TWO surfaces at once, on purpose:
 *   - the generic Plugins list (PluginsTab) — the honest "it's a plugin" lens;
 *   - a dedicated Settings nav entry + the richer page below — the product lens.
 *
 * Crucially this is dual *surfacing*, not dual *state*: both surfaces toggle the
 * SAME `plugins.enabled` flag, keyed on the live plugin's REAL registered
 * `name` (found via `match`, never a hardcoded guess), so they cannot drift.
 *
 * To promote another plugin, add a descriptor to {@link FEATURED_FEATURES}. No
 * other file needs to special-case it — the nav, the page, and the Plugins-list
 * cross-reference are all registry-driven.
 */
export interface FeaturedFeature {
  /**
   * Stable Settings nav tab id, also used as the URL hash. MUST NOT collide
   * with a `CoreTab` id in SettingsView.
   */
  id: string
  /** lucide icon node, rendered in the nav row and the page header. */
  icon: ReactNode
  /** i18n key for the nav label + page title. */
  titleKey: MessageKey
  /** i18n key for the page subtitle. */
  subtitleKey: MessageKey
  /**
   * Identify the backing plugin within the live `/hermes/plugins` list. We
   * MATCH rather than hardcode a single name so the enable/disable toggle keys
   * on the plugin's real registered `name`, robust to distribution-name vs
   * import-name vs entry-point-name drift.
   */
  match: (p: HermesPlugin) => boolean
  /**
   * Plugin reference (git slug / package spec) for `hermes plugins install`,
   * used when the backing plugin is missing: the "Install" button hands this
   * to the agent so a normal user never touches a terminal. Omit if the plugin
   * can't be auto-installed this way.
   */
  installRef?: string
  /**
   * Feature-specific content rendered below the standard enable/disable
   * control. This is what *earns* a featured plugin its dedicated page — if a
   * feature only needs an on/off switch, it shouldn't be promoted here.
   */
  Body?: () => ReactNode
}

// ---------------------------------------------------------------------------
// The registry — add a descriptor here to promote a plugin to a featured feature
// ---------------------------------------------------------------------------

/**
 * Browser control — registers `my_browser_*` tools + a local WebSocket hub the
 * companion Chrome extension connects to. Backed by the
 * `hermes-x-plugin-browser-tools` plugin (matched loosely to survive the
 * hyphen/underscore dist-vs-import naming split).
 */
const BROWSER_FEATURE: FeaturedFeature = {
  id: "browser",
  icon: <Globe className="h-4 w-4 shrink-0 opacity-70" />,
  titleKey: "options.feature.browser.title",
  subtitleKey: "options.feature.browser.subtitle",
  match: (p) =>
    /browser[-_]tools/.test(p.name) || /browser[-_]tools/.test(p.key),
  installRef: "iHeyTang/hermes-x-plugin-browser-tools",
  Body: BrowserFeatureBody,
}

export const FEATURED_FEATURES: readonly FeaturedFeature[] = [BROWSER_FEATURE]

const FEATURED_FEATURE_IDS = new Set(FEATURED_FEATURES.map((f) => f.id))

export function isFeaturedFeatureId(id: string): boolean {
  return FEATURED_FEATURE_IDS.has(id)
}

export function featuredFeatureById(id: string): FeaturedFeature | undefined {
  return FEATURED_FEATURES.find((f) => f.id === id)
}

/** The featured feature a given plugin row is the backing of, if any. */
export function featuredFeatureForPlugin(
  p: HermesPlugin,
): FeaturedFeature | undefined {
  return FEATURED_FEATURES.find((f) => f.match(p))
}

/** Navigate the Settings shell to a featured feature's dedicated page. */
export function openFeaturedFeature(id: string): void {
  if (typeof window !== "undefined") window.location.hash = `#${id}`
}

// ---------------------------------------------------------------------------
// The generic dedicated page — same shell for every featured feature
// ---------------------------------------------------------------------------

type PageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; plugin: HermesPlugin | null }

/**
 * The dedicated page for a featured feature: a standard enable/disable control
 * (backed by the live plugin's real name) plus the feature's own `Body`. The
 * toggle shares its data path with PluginsTab (`/hermes/plugins` + the same
 * optimistic flip + restart hint), so a flip here and a flip there agree.
 */
export function FeatureSettingsPage({ feature }: { feature: FeaturedFeature }) {
  const { t } = useT()
  const startAgentTask = useStartAgentTask()
  const [state, setState] = useState<PageState>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [restartHint, setRestartHint] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setState({ kind: "loading" })
    void getHermesPlugins().then((res) => {
      if (!res.ok) {
        setState({ kind: "error" })
        return
      }
      setState({ kind: "loaded", plugin: res.plugins.find(feature.match) ?? null })
    })
  }, [feature])

  useEffect(() => {
    reload()
  }, [reload])

  async function onToggle() {
    if (state.kind !== "loaded" || !state.plugin || busy) return
    const p = state.plugin
    const next = !p.enabled
    setBusy(true)
    setToggleError(null)
    const res = await setPluginEnabled(p.name, next)
    setBusy(false)
    if (!res.ok) {
      setToggleError(t("options.plugins.toggleError", { error: res.error ?? "unknown" }))
      return
    }
    setState({ kind: "loaded", plugin: { ...p, enabled: next } })
    setRestartHint(true)
  }

  // Hand installation to the agent instead of telling the user to run a CLI.
  function onInstall() {
    if (!startAgentTask || !feature.installRef) return
    void startAgentTask(
      t("options.feature.installPrompt", {
        name: t(feature.titleKey),
        ref: feature.installRef,
      }),
      { sourceApp: t("options.feature.agentSourceApp") },
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader title={t(feature.titleKey)} subtitle={t(feature.subtitleKey)} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
          {state.kind === "loading" && (
            <p className="text-sm text-muted-foreground">{t("options.plugins.loading")}</p>
          )}

          {state.kind === "error" && (
            <p className="text-sm text-muted-foreground">{t("options.feature.backplaneError")}</p>
          )}

          {state.kind === "loaded" && !state.plugin && (
            <div className="flex flex-col items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm text-amber-700">{t("options.feature.notInstalled")}</p>
              {startAgentTask && feature.installRef && (
                <Button size="sm" onClick={onInstall}>
                  {t("options.feature.installAction")}
                </Button>
              )}
            </div>
          )}

          {state.kind === "loaded" && state.plugin && (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-card p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{t("options.feature.enableLabel")}</span>
                <span className="text-xs text-muted-foreground">
                  {state.plugin.enabled
                    ? t("options.feature.stateOn")
                    : t("options.feature.stateOff")}
                </span>
              </div>
              <Switch
                checked={state.plugin.enabled}
                disabled={busy}
                onCheckedChange={() => void onToggle()}
              />
            </div>
          )}

          {restartHint && (
            <p className="text-xs text-amber-600">{t("options.plugins.restartHint")}</p>
          )}
          {toggleError && <p className="text-sm text-destructive">{toggleError}</p>}

          {feature.Body && <feature.Body />}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feature-specific bodies
// ---------------------------------------------------------------------------

function BrowserFeatureBody() {
  const { t } = useT()
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("options.feature.browser.how.title")}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("options.feature.browser.how.body")}
      </p>
    </section>
  )
}
