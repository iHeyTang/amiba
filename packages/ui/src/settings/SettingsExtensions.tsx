import { FolderOpen, RefreshCw, Trash2 } from "lucide-react"
import { useState } from "react"

import { useExtensionRegistry } from "@hermes-x/extension-host/renderer"
import type { ExtensionsBridge } from "@hermes-x/extension-host/preload"
import { useT } from "@hermes-x/i18n"
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

export function SettingsExtensions() {
  const { t } = useT()
  const [refreshKey, setRefreshKey] = useState(0)
  const items = useExtensionRegistry(refreshKey)

  const [sideloadError, setSideloadError] = useState<string | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // extensionId currently being acted on

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  async function handleSideload() {
    setSideloadError(null)
    const ext = getExtensions()
    const folderPath = await ext.pickFolder()
    if (!folderPath) return
    const result = await ext.sideload(folderPath)
    if (!result.ok) {
      setSideloadError(t("options.extensions.sideload.error", { error: result.error ?? "unknown" }))
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

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("options.extensions.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("options.extensions.subtitle")}</p>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSideload()}
        >
          <FolderOpen />
          {t("options.extensions.sideload")}
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

      {/* Sideload error */}
      {sideloadError && (
        <p className="text-sm text-destructive">{sideloadError}</p>
      )}

      {/* Extension list */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("options.extensions.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {items.map((ext) => (
            <li key={ext.id} className="flex flex-col gap-1 p-3">
              <div className="flex items-start justify-between gap-2">
                {/* Left: name + id badge */}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ext.manifest.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs",
                        ext.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-emerald-500/15 text-emerald-600",
                      )}
                    >
                      {ext.status === "failed"
                        ? t("options.extensions.status.failed")
                        : t("options.extensions.status.loaded")}
                    </span>
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
                    onClick={() => setPendingUninstall({ id: ext.id, name: ext.manifest.name })}
                    title={t("options.extensions.uninstall")}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 />
                    {t("options.extensions.uninstall")}
                  </Button>
                </div>
              </div>

              {/* Error stack */}
              {ext.error && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-destructive">
                    {t("options.extensions.showError")}
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

      {/* Uninstall confirm dialog */}
      <Dialog open={pendingUninstall !== null} onOpenChange={(open) => { if (!open) setPendingUninstall(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("options.extensions.uninstall.confirm.title")}</DialogTitle>
            <DialogDescription>
              {pendingUninstall
                ? t("options.extensions.uninstall.confirm.body", {
                    name: pendingUninstall.name,
                    id: pendingUninstall.id,
                  })
                : null}
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
