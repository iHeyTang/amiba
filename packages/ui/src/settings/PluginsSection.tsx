import { getHermesPlugins, setPluginEnabled, type HermesPlugin } from "@hermes-x/core"
import { useEffect, useState } from "react"

import { useT } from "@hermes-x/i18n"
import { Switch, cn } from "../primitives"

type State =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "loaded"; plugins: HermesPlugin[] }

/**
 * Hermes-agent plugins (Python), distinct from renderer extensions above.
 * Read from the backplane's /hermes/plugins (which mirrors `hermes plugins
 * list`). Enable/disable edits config.yaml only — it does NOT hot-reload, so
 * we flip the switch optimistically and show a persistent "restart to apply"
 * hint rather than refetch (which would snap back to the still-loaded state).
 */
export function PluginsSection() {
  const { t } = useT()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [showBundled, setShowBundled] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [restartHint, setRestartHint] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    void getHermesPlugins().then((res) => {
      if (cancelled) return
      setState(
        res.ok
          ? { kind: "loaded", plugins: res.plugins }
          : { kind: "error", error: "backplane unreachable" },
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function onToggle(p: HermesPlugin) {
    if (state.kind !== "loaded") return
    setBusy(p.name)
    setToggleError(null)
    const next = !p.enabled
    const res = await setPluginEnabled(p.name, next)
    setBusy(null)
    if (!res.ok) {
      setToggleError(t("options.plugins.toggleError", { error: res.error ?? "unknown" }))
      return
    }
    // Optimistic: reflect desired config state; it applies on restart.
    setState({
      kind: "loaded",
      plugins: state.plugins.map((x) => (x.name === p.name ? { ...x, enabled: next } : x)),
    })
    setRestartHint(true)
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{t("options.plugins.heading")}</h3>
        <p className="text-sm text-muted-foreground">{t("options.plugins.subtitle")}</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground w-fit">
        <Switch checked={showBundled} onCheckedChange={setShowBundled} />
        {t("options.plugins.showBundled")}
      </label>

      {restartHint && (
        <p className="text-xs text-amber-600">{t("options.plugins.restartHint")}</p>
      )}
      {toggleError && <p className="text-sm text-destructive">{toggleError}</p>}

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">{t("options.plugins.loading")}</p>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-muted-foreground">
          {t("options.plugins.error", { error: state.error })}
        </p>
      )}
      {state.kind === "loaded" && <PluginList
        plugins={state.plugins}
        showBundled={showBundled}
        busy={busy}
        onToggle={onToggle}
        emptyLabel={t("options.plugins.empty")}
      />}
    </div>
  )
}

function PluginList({
  plugins,
  showBundled,
  busy,
  onToggle,
  emptyLabel,
}: {
  plugins: HermesPlugin[]
  showBundled: boolean
  busy: string | null
  onToggle: (p: HermesPlugin) => void
  emptyLabel: string
}) {
  const visible = (showBundled ? plugins : plugins.filter((p) => p.source !== "bundled"))
    .slice()
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-card">
      {visible.map((p) => (
        <li key={p.key} className="flex items-start justify-between gap-2 p-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {p.source}
              </span>
              {p.kind && p.kind !== "standalone" && (
                <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-600">
                  {p.kind}
                </span>
              )}
              {p.error && (
                <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                  error
                </span>
              )}
            </div>
            {p.description && (
              <span className="truncate text-xs text-muted-foreground">{p.description}</span>
            )}
            <code className="text-[11px] text-muted-foreground">
              {p.key}
              {p.version ? ` · v${p.version}` : ""}
            </code>
          </div>
          <div className={cn("flex shrink-0 items-center", busy === p.name && "opacity-50")}>
            <Switch
              checked={p.enabled}
              disabled={busy === p.name}
              onCheckedChange={() => onToggle(p)}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
