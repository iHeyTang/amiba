import { Download, FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useExtensionRegistry } from "@hermes-x/extension-host/renderer"
import type { ExtensionsBridge, MarketplaceEntry } from "@hermes-x/extension-host/preload"
import { useT } from "@hermes-x/i18n"
import { PluginsSection } from "./PluginsSection"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from "../primitives"

function getExtensions(): ExtensionsBridge {
  return (window as unknown as { hermes: { extensions: ExtensionsBridge } }).hermes.extensions
}

// ---------------------------------------------------------------------------
// Browse tab
// ---------------------------------------------------------------------------

type BrowseState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "loaded"; entries: MarketplaceEntry[]; indexUrl: string }

function BrowseTab({
  installedIds,
  onInstallComplete,
}: {
  installedIds: Set<string>
  onInstallComplete: () => void
}) {
  const { t } = useT()
  const [state, setState] = useState<BrowseState>({ kind: "idle" })
  const [installing, setInstalling] = useState<string | null>(null)
  const [installError, setInstallError] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    const ext = getExtensions()
    void Promise.all([ext.marketplace.list(), ext.marketplace.getIndexUrl()]).then(
      ([result, indexUrl]) => {
        if (cancelled) return
        if (!result.ok) {
          setState({ kind: "error", error: result.error })
        } else {
          setState({ kind: "loaded", entries: result.entries, indexUrl })
        }
      },
    ).catch((e: unknown) => {
      if (cancelled) return
      setState({ kind: "error", error: e instanceof Error ? e.message : String(e) })
    })
    return () => { cancelled = true }
  }, [])

  async function handleInstall(entry: MarketplaceEntry) {
    setInstalling(entry.id)
    setInstallError((prev) => {
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    try {
      const result = await getExtensions().marketplace.install(entry)
      if (!result.ok) {
        setInstallError((prev) => ({ ...prev, [entry.id]: result.error }))
      } else {
        onInstallComplete()
      }
    } catch (e: unknown) {
      setInstallError((prev) => ({
        ...prev,
        [entry.id]: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setInstalling(null)
    }
  }

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("options.extensions.browse.loading")}
      </div>
    )
  }

  if (state.kind === "error") {
    return (
      <p className="py-4 text-sm text-destructive">
        {t("options.extensions.browse.error", { error: state.error })}
      </p>
    )
  }

  const { entries, indexUrl } = state

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t("options.extensions.browse.empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {entries.map((entry) => {
            const isInstalled = installedIds.has(entry.id)
            const isInstalling = installing === entry.id
            const err = installError[entry.id]
            return (
              <li key={entry.id} className="flex flex-col gap-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  {/* Left: name + meta */}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.name}</span>
                      {entry.version && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {entry.version}
                        </span>
                      )}
                    </div>
                    {entry.description && (
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                    )}
                    {entry.author && (
                      <code className="text-xs text-muted-foreground">{entry.author}</code>
                    )}
                  </div>

                  {/* Right: action button */}
                  <div className="shrink-0">
                    {isInstalled ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
                        {t("options.extensions.browse.installed")}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isInstalling}
                        onClick={() => void handleInstall(entry)}
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("options.extensions.browse.installing")}
                          </>
                        ) : (
                          <>
                            <Download />
                            {t("options.extensions.browse.install")}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Install error */}
                {err && (
                  <p className="text-xs text-destructive">
                    {t("options.extensions.browse.installFailed", { error: err })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Index URL footer */}
      <p className="text-xs text-muted-foreground">
        {t("options.extensions.browse.indexUrl", { url: indexUrl })}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Tab = "installed" | "browse"

export function SettingsExtensions() {
  const { t } = useT()
  const [activeTab, setActiveTab] = useState<Tab>("installed")
  const [refreshKey, setRefreshKey] = useState(0)
  const items = useExtensionRegistry(refreshKey)

  const [addLocalError, setAddLocalError] = useState<string | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<{
    id: string
    name: string
    source?: string
    path?: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // extensionId currently being acted on

  // Subscribe to extensions:changed (fired after marketplace install) so the
  // installed list refreshes automatically.
  useEffect(() => {
    const unsub = getExtensions().onExtensionsChanged(() => {
      setRefreshKey((k) => k + 1)
    })
    return unsub
  }, [])

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  async function handleAddLocal() {
    setAddLocalError(null)
    const ext = getExtensions()
    const folderPath = await ext.pickFolder()
    if (!folderPath) return
    const result = await ext.addLocal(folderPath)
    if (!result.ok) {
      setAddLocalError(t("options.extensions.sideload.error", { error: result.error ?? "unknown" }))
    } else {
      refresh()
    }
  }

  async function handleReload(id: string) {
    setBusy(id)
    try {
      await getExtensions().reload(id)
      refresh()
    } finally {
      setBusy(null)
    }
  }

  async function handleUninstallConfirm() {
    if (!pendingUninstall) return
    const { id } = pendingUninstall
    setPendingUninstall(null)
    setBusy(id)
    try {
      await getExtensions().uninstall(id)
      refresh()
    } finally {
      setBusy(null)
    }
  }

  const installedIds = new Set(items.map((i) => i.id))

  const uninstallBodyText = pendingUninstall
    ? pendingUninstall.source === "local"
      ? t("options.extensions.uninstall.confirm.body.local", {
          name: pendingUninstall.name,
          path: pendingUninstall.path ?? "",
        })
      : t("options.extensions.uninstall.confirm.body", {
          name: pendingUninstall.name,
          id: pendingUninstall.id,
        })
    : null

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("options.extensions.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("options.extensions.subtitle")}</p>
      </div>

      {/* Sub-tab toggle */}
      <div className="flex items-center rounded-md border bg-muted p-1 w-fit gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("installed")}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            activeTab === "installed"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("options.extensions.tab.installed")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("browse")}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            activeTab === "browse"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("options.extensions.tab.browse")}
        </button>
      </div>

      {/* ---- Installed tab ---- */}
      {activeTab === "installed" && (
        <>
          {/* Action row */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAddLocal()}
            >
              <FolderOpen />
              {t("options.extensions.addLocal")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
            >
              <RefreshCw />
              {t("options.extensions.refresh")}
            </Button>
          </div>

          {/* Add-local error */}
          {addLocalError && (
            <p className="text-sm text-destructive">{addLocalError}</p>
          )}

          {/* Extension list */}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("options.extensions.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border bg-card">
              {items.map((ext) => (
                <li key={ext.id} className="flex flex-col gap-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* Left: name + id badge + source badge */}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{ext.manifest.name}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-xs",
                            ext.status === "failed"
                              ? "bg-destructive/15 text-destructive"
                              : ext.status === "incompatible"
                                ? "bg-amber-500/15 text-amber-600"
                                : "bg-emerald-500/15 text-emerald-600",
                          )}
                        >
                          {ext.status === "failed"
                            ? t("options.extensions.status.failed")
                            : ext.status === "incompatible"
                              ? t("options.extensions.status.incompatible")
                              : t("options.extensions.status.loaded")}
                        </span>
                        {/* Source badge */}
                        {ext.source === "local" ? (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {t("options.extensions.source.local")}
                          </span>
                        ) : ext.source === "marketplace" ? (
                          <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-600">
                            {t("options.extensions.source.marketplace")}
                          </span>
                        ) : null}
                      </div>
                      <code className="text-xs text-muted-foreground">
                        {ext.id} · v{ext.manifest.version}
                      </code>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === ext.id}
                        onClick={() => void handleReload(ext.id)}
                        title={t("options.extensions.reload")}
                      >
                        <RefreshCw />
                        {t("options.extensions.reload")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === ext.id}
                        onClick={() => setPendingUninstall({
                          id: ext.id,
                          name: ext.manifest.name,
                          source: ext.source,
                        })}
                        title={t("options.extensions.uninstall")}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 />
                        {t("options.extensions.uninstall")}
                      </Button>
                    </div>
                  </div>

                  {/* Error / reason stack */}
                  {ext.error && (
                    <details className="mt-1 text-xs">
                      <summary
                        className={cn(
                          "cursor-pointer",
                          ext.status === "incompatible"
                            ? "text-muted-foreground"
                            : "text-destructive",
                        )}
                      >
                        {ext.status === "incompatible"
                          ? t("options.extensions.showDetails")
                          : t("options.extensions.showError")}
                      </summary>
                      <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-[11px]">
                        {ext.error}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---- Browse tab ---- */}
      {activeTab === "browse" && (
        <BrowseTab
          installedIds={installedIds}
          onInstallComplete={refresh}
        />
      )}

      {/* ---- Plugins (hermes-agent, distinct type) ---- */}
      <PluginsSection />

      {/* Uninstall confirm dialog */}
      <Dialog open={pendingUninstall !== null} onOpenChange={(open) => { if (!open) setPendingUninstall(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("options.extensions.uninstall.confirm.title")}</DialogTitle>
            <DialogDescription>
              {uninstallBodyText}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingUninstall(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void handleUninstallConfirm()}>
              {t("options.extensions.uninstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
