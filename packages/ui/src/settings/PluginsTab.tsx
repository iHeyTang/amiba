import { getHermesPlugins, setPluginEnabled, uninstallPlugin, type HermesPlugin } from "@amiba/core"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useT } from "@amiba/i18n"
import { Button, Switch, cn } from "../primitives"
import { useStartAgentTask } from "./agent-task"

type State =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "loaded"; plugins: HermesPlugin[] }

/**
 * Hermes-agent plugins (Python) — the "Plugins" type tab, distinct from
 * renderer extensions. Read from the backplane's /hermes/plugins (which mirrors
 * `hermes plugins list`). Enable/disable edits config.yaml only — no hot-reload
 * — so we flip optimistically and show a "restart to apply" hint. Uninstall is
 * source-aware on the backplane (user → remove dir; entrypoint → pip uninstall;
 * bundled/project → refused), so only user/entrypoint rows get a delete button;
 * on success we drop the row and show the restart hint. Installation is handed
 * to the Agent so the user does not have to work through the operator CLI.
 *
 * Bundled plugins implement Agent abilities and are intentionally hidden here.
 * This inventory contains only plugins the user added.
 */
export function PluginsTab() {
  const { t } = useT()
  const startAgentTask = useStartAgentTask()
  const [state, setState] = useState<State>({ kind: "loading" })
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
    if (state.kind !== "loaded" || busy) return
    setBusy(p.name)
    setToggleError(null)
    const next = !p.enabled
    const res = await setPluginEnabled(p.name, next)
    setBusy(null)
    if (!res.ok) {
      setToggleError(t("options.plugins.toggleError", { error: res.error ?? "unknown" }))
      return
    }
    setState({
      kind: "loaded",
      plugins: state.plugins.map((x) => (x.name === p.name ? { ...x, enabled: next } : x)),
    })
    setRestartHint(true)
  }

  async function onUninstall(p: HermesPlugin) {
    if (state.kind !== "loaded" || busy) return
    if (!confirm(t("options.plugins.uninstallConfirm", { name: p.name }))) return
    setBusy(p.name)
    setToggleError(null)
    const res = await uninstallPlugin(p.name)
    setBusy(null)
    if (!res.ok) {
      setToggleError(t("options.plugins.uninstallError", { error: res.error ?? "unknown" }))
      return
    }
    setState({ kind: "loaded", plugins: state.plugins.filter((x) => x.key !== p.key) })
    setRestartHint(true)
  }

  function onInstall() {
    if (!startAgentTask) return
    void startAgentTask(t("externalTools.plugin.addPrompt"), {
      sourceApp: t("options.extensions.title"),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("options.plugins.subtitle")}</p>
        {startAgentTask && (
          <Button type="button" size="sm" onClick={onInstall}>
            <Plus className="h-3.5 w-3.5" />
            {t("externalTools.plugin.add")}
          </Button>
        )}
      </div>

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
      {state.kind === "loaded" && (
        <PluginGroups
          plugins={state.plugins}
          busy={busy}
          onToggle={onToggle}
          onUninstall={onUninstall}
        />
      )}
    </div>
  )
}

function sortPlugins(list: HermesPlugin[]): HermesPlugin[] {
  return list
    .slice()
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
}

function PluginGroups({
  plugins,
  busy,
  onToggle,
  onUninstall,
}: {
  plugins: HermesPlugin[]
  busy: string | null
  onToggle: (p: HermesPlugin) => void
  onUninstall: (p: HermesPlugin) => void
}) {
  const { t } = useT()
  const yours = sortPlugins(plugins.filter((p) => p.source !== "bundled"))

  return (
    <section className="flex flex-col gap-1.5">
      {yours.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("options.plugins.empty")}</p>
      ) : (
        <PluginList
          plugins={yours}
          busy={busy}
          onToggle={onToggle}
          onUninstall={onUninstall}
        />
      )}
    </section>
  )
}

function PluginList({
  plugins,
  busy,
  onToggle,
  onUninstall,
}: {
  plugins: HermesPlugin[]
  busy: string | null
  onToggle: (p: HermesPlugin) => void
  onUninstall: (p: HermesPlugin) => void
}) {
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-card">
      {plugins.map((p) => (
        <PluginRow
          key={p.key}
          p={p}
          busy={busy === p.name}
          onToggle={() => onToggle(p)}
          onUninstall={() => onUninstall(p)}
        />
      ))}
    </ul>
  )
}

function PluginRow({
  p,
  busy,
  onToggle,
  onUninstall,
}: {
  p: HermesPlugin
  busy: boolean
  onToggle: () => void
  onUninstall: () => void
}) {
  const { t } = useT()
  // Nested/category plugins (e.g. backends) share a `name` across categories —
  // `name` alone isn't unique. The key is path-derived (`image_gen/xai`), so
  // surface the category prefix as a badge to disambiguate same-named plugins.
  const slash = p.key.indexOf("/")
  const category = slash > 0 ? p.key.slice(0, slash) : null
  // Only user (directory) and entrypoint (pip) plugins are uninstallable; the
  // backplane removes them deterministically by source. bundled ships with
  // hermes-agent and project plugins are repo-owned — neither gets a button.
  const canUninstall = p.source === "user" || p.source === "entrypoint"
  return (
    <li className="flex items-start justify-between gap-2 p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.name}</span>
          {category && (
            <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600">
              {category}
            </span>
          )}
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
        {p.dist && <code className="text-[11px] text-muted-foreground">pip: {p.dist}</code>}
      </div>
      <div className={cn("flex shrink-0 items-center gap-1 pt-0.5", busy && "opacity-50")}>
        {canUninstall && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUninstall}
            title={t("options.plugins.uninstallAction")}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}
        <Switch checked={p.enabled} disabled={busy} onCheckedChange={onToggle} />
      </div>
    </li>
  )
}
