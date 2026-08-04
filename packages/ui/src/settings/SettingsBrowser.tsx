import { useCallback, useEffect, useState } from "react"

import {
  getHermesPlugins,
  setPluginEnabled,
  type HermesPlugin,
} from "@amiba/core"
import { useT } from "@amiba/i18n"

import { Button, ScrollArea, Switch } from "../primitives"
import { useStartAgentTask } from "./agent-task"
import { SettingsPaneHeader } from "./SettingsPaneHeader"

/**
 * Browser control settings — a plain "General" tab.
 *
 * Browser control is backed by the `amiba-plugin-browser-tools` hermes-agent
 * plugin (registers `my_browser_*` tools + a local WebSocket hub the companion
 * Chrome extension connects to). This page is the product-facing on/off + how-
 * it-works surface; it shares its enable/disable path with PluginsTab
 * (`/hermes/plugins` + the same restart hint), keyed on the live plugin's REAL
 * registered name so the two can't drift.
 *
 * The plugin is matched loosely (hyphen/underscore, dist-vs-import name split)
 * rather than hardcoded to one string.
 */
const matchBrowserPlugin = (p: HermesPlugin): boolean =>
  /browser[-_]tools/.test(p.name) || /browser[-_]tools/.test(p.key)

/** Plugin ref handed to the agent for `hermes plugins install` when missing. */
const INSTALL_REF = "amiba-desktop/amiba-plugin-browser-tools"

type PageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; plugin: HermesPlugin | null }

export function SettingsBrowser({
  embedded = false,
  profileId,
}: {
  embedded?: boolean
  profileId?: string
} = {}) {
  const { t } = useT()
  const startAgentTask = useStartAgentTask()
  const [state, setState] = useState<PageState>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [restartHint, setRestartHint] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setState({ kind: "loading" })
    void getHermesPlugins(profileId).then((res) => {
      if (!res.ok) {
        setState({ kind: "error" })
        return
      }
      setState({ kind: "loaded", plugin: res.plugins.find(matchBrowserPlugin) ?? null })
    })
  }, [profileId])

  useEffect(() => {
    reload()
  }, [reload])

  async function onToggle() {
    if (state.kind !== "loaded" || !state.plugin || busy) return
    const p = state.plugin
    const next = !p.enabled
    setBusy(true)
    setToggleError(null)
    const res = await setPluginEnabled(p.name, next, profileId)
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
    if (!startAgentTask) return
    void startAgentTask(
      t("options.feature.installPrompt", {
        name: t("options.feature.browser.title"),
        ref: INSTALL_REF,
      }),
      { sourceApp: t("options.feature.agentSourceApp") },
    )
  }

  const content = (
    <div className="flex flex-col gap-4">
      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">{t("options.plugins.loading")}</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-muted-foreground">{t("options.feature.backplaneError")}</p>
      )}

      {state.kind === "loaded" && !state.plugin && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-700">{t("options.feature.notInstalled")}</p>
          {startAgentTask && (
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
        <p className="text-xs text-amber-600">{t("options.feature.restartHint")}</p>
      )}
      {toggleError && <p className="text-sm text-destructive">{toggleError}</p>}

      {!embedded && (
        <section className="flex flex-col gap-2 rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">{t("options.feature.browser.how.title")}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("options.feature.browser.how.body")}
          </p>
        </section>
      )}
    </div>
  )

  if (embedded) {
    return (
      <section className="border-t border-border/60 pt-5">
        <h3 className="text-sm font-medium">
          {t("tools.detail.browser.currentTabTitle")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("tools.detail.browser.currentTabDescription")}
        </p>
        <div className="mt-3">{content}</div>
      </section>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader
        title={t("options.feature.browser.title")}
        subtitle={t("options.feature.browser.subtitle")}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl p-6">
          {content}
        </div>
      </ScrollArea>
    </div>
  )
}
