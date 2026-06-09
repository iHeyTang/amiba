import { getHermesPlugins, setPluginEnabled, type HermesPlugin } from "@hermes-x/core"
import { Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useT } from "@hermes-x/i18n"
import { Button, Switch, cn } from "../primitives"
import { useStartAgentTask } from "./agent-task"
import { featuredFeatureForPlugin, openFeaturedFeature } from "./featured-features"

type State =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "loaded"; plugins: HermesPlugin[] }

/**
 * Hermes-agent plugins (Python) — the "Plugins" type tab, distinct from
 * renderer extensions. Read from the backplane's /hermes/plugins (which mirrors
 * `hermes plugins list`); the only UI action is enable/disable. Install/remove
 * stays with the `hermes plugins` operator CLI, so there are deliberately no
 * install/remove affordances here.
 *
 * Plugins split naturally into "yours" (user / project / pip) and "bundled"
 * (20+ shipped with hermes-agent), so we group rather than dump a flat list.
 * Enable/disable edits config.yaml only — no hot-reload — so we flip the switch
 * optimistically and show a persistent "restart to apply" hint instead of
 * refetching (which would snap back to the still-loaded state).
 */
export function PluginsTab() {
  const { t } = useT()
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("options.plugins.subtitle")}</p>

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
        <PluginGroups plugins={state.plugins} busy={busy} onToggle={onToggle} />
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
}: {
  plugins: HermesPlugin[]
  busy: string | null
  onToggle: (p: HermesPlugin) => void
}) {
  const { t } = useT()
  const yours = sortPlugins(plugins.filter((p) => p.source !== "bundled"))
  const bundled = sortPlugins(plugins.filter((p) => p.source === "bundled"))

  return (
    <div className="flex flex-col gap-4">
      {/* Yours — always shown; this is what the user installed */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">{t("options.plugins.group.yours")}</h3>
        {yours.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("options.plugins.empty")}</p>
        ) : (
          <PluginList plugins={yours} busy={busy} onToggle={onToggle} />
        )}
      </section>

      {/* Bundled — collapsed by default (20+ ship with hermes-agent) */}
      {bundled.length > 0 && (
        <details className="flex flex-col gap-1.5">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
            {t("options.plugins.group.bundled", { count: bundled.length })}
          </summary>
          <div className="mt-1.5">
            <PluginList plugins={bundled} busy={busy} onToggle={onToggle} />
          </div>
        </details>
      )}
    </div>
  )
}

function PluginList({
  plugins,
  busy,
  onToggle,
}: {
  plugins: HermesPlugin[]
  busy: string | null
  onToggle: (p: HermesPlugin) => void
}) {
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-card">
      {plugins.map((p) => (
        <PluginRow key={p.key} p={p} busy={busy === p.name} onToggle={() => onToggle(p)} />
      ))}
    </ul>
  )
}

function PluginRow({ p, busy, onToggle }: { p: HermesPlugin; busy: boolean; onToggle: () => void }) {
  const { t } = useT()
  const startAgentTask = useStartAgentTask()
  // Nested/category plugins (e.g. backends) share a `name` across categories —
  // `name` alone isn't unique. The key is path-derived (`image_gen/xai`), so
  // surface the category prefix as a badge to disambiguate same-named plugins.
  const slash = p.key.indexOf("/")
  const category = slash > 0 ? p.key.slice(0, slash) : null
  // A plugin promoted to a first-class "featured feature" still appears here
  // (it really is a plugin) — but we flag the dual-surfacing so it reads as
  // intentional, and offer a jump to its dedicated page.
  const feature = featuredFeatureForPlugin(p)
  // Only user-installed plugins are uninstallable; bundled plugins ship with
  // hermes-agent. We hand removal to the agent (no terminal for the user) —
  // gated on the host providing a chat surface.
  const canUninstall = !!startAgentTask && p.source !== "bundled"
  function onUninstall() {
    if (!startAgentTask) return
    if (!confirm(t("options.plugins.uninstallConfirm", { name: p.name }))) return
    void startAgentTask(t("options.plugins.uninstallPrompt", { name: p.name }), {
      sourceApp: t("options.plugins.agentSourceApp"),
    })
  }
  return (
    <li className="flex items-start justify-between gap-2 p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.name}</span>
          {feature && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
              {t("options.plugins.featuredBadge")}
            </span>
          )}
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
        {feature && (
          <button
            type="button"
            onClick={() => openFeaturedFeature(feature.id)}
            className="self-start text-xs font-medium text-primary hover:underline"
          >
            {t("options.plugins.manageInFeature", { name: t(feature.titleKey) })}
          </button>
        )}
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
