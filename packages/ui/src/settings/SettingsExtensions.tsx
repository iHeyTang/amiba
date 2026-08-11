import { FolderOpen, RefreshCw, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import {
  useExtensionRegistry,
  desktopBridge,
} from "@amiba/extension-host/renderer"
import type { ExtensionsBridge } from "@amiba/extension-host/preload"
import { useT } from "@amiba/i18n"
import { PluginsTab } from "./PluginsTab"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "../primitives"

function getExtensions(): ExtensionsBridge {
  return desktopBridge().extensions
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ExtensionsTab() {
  const { t } = useT()
  const [refreshKey, setRefreshKey] = useState(0)
  const items = useExtensionRegistry(refreshKey)

  const [addLocalError, setAddLocalError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
      setAddLocalError(
        t("options.extensions.sideload.error", {
          error: result.error ?? "unknown",
        }),
      )
    } else {
      refresh()
    }
  }

  async function handleReload(id: string) {
    setActionError(null)
    setBusy(id)
    try {
      const result = await getExtensions().reload(id)
      if (!result.ok) {
        setActionError(
          t("options.extensions.actionFailed", {
            error: result.error ?? "unknown",
          }),
        )
      }
      refresh()
    } finally {
      setBusy(null)
    }
  }

  async function handleUninstallConfirm() {
    if (!pendingUninstall) return
    const { id } = pendingUninstall
    setPendingUninstall(null)
    setActionError(null)
    setBusy(id)
    try {
      const result = await getExtensions().uninstall(id)
      if (!result.ok) {
        setActionError(
          t("options.extensions.actionFailed", {
            error: result.error ?? "unknown",
          }),
        )
      }
      refresh()
    } finally {
      setBusy(null)
    }
  }

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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t("options.extensions.subtitle")}
      </p>

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
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw />
          {t("options.extensions.refresh")}
        </Button>
      </div>

      {/* Add-local error */}
      {addLocalError && (
        <p className="text-sm text-destructive">{addLocalError}</p>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {/* Extension list */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("options.extensions.empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {items.map((ext) => {
            const name = ext.manifest?.name ?? ext.id
            const version = ext.manifest?.version ?? ext.version
            return (
              <li key={ext.id} className="flex flex-col gap-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  {/* Left: name + id badge + source badge */}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs",
                          ext.status === "failed"
                            ? "bg-destructive/15 text-destructive"
                            : ext.status === "incompatible" ||
                                ext.status === "registered"
                              ? "bg-amber-500/15 text-amber-600"
                              : ext.status === "disabled"
                                ? "bg-muted text-muted-foreground"
                                : "bg-emerald-500/15 text-emerald-600",
                        )}
                      >
                        {ext.status === "failed"
                          ? t("options.extensions.status.failed")
                          : ext.status === "incompatible"
                            ? t("options.extensions.status.incompatible")
                            : ext.status === "disabled"
                              ? t("options.extensions.status.disabled")
                              : ext.status === "registered"
                                ? t("options.extensions.status.registered")
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
                      ) : ext.source === "bundled" ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t("options.extensions.source.bundled")}
                        </span>
                      ) : null}
                    </div>
                    <code className="text-xs text-muted-foreground">
                      {ext.id}
                      {version ? ` · v${version}` : ""}
                    </code>
                    <code className="break-all text-xs text-muted-foreground">
                      {ext.path}
                    </code>
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex shrink-0 items-center gap-1">
                    {ext.status !== "disabled" && (
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
                    )}
                    {ext.source !== "bundled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === ext.id}
                        onClick={() =>
                          setPendingUninstall({
                            id: ext.id,
                            name,
                            source: ext.source,
                            path: ext.path,
                          })
                        }
                        title={t("options.extensions.uninstall")}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 />
                        {t("options.extensions.uninstall")}
                      </Button>
                    )}
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
                    <pre
                      data-selection="text"
                      className="mt-1 overflow-auto rounded bg-muted p-2 text-[11px]"
                    >
                      {ext.error}
                    </pre>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Uninstall confirm dialog */}
      <Dialog
        open={pendingUninstall !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUninstall(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("options.extensions.uninstall.confirm.title")}
            </DialogTitle>
            <DialogDescription>{uninstallBodyText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingUninstall(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleUninstallConfirm()}
            >
              {t("options.extensions.uninstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Application extensions and Agent plugins live here. MCP is a source of
// Agent tools, so it is configured in Tools.
// ---------------------------------------------------------------------------

function SettingsPane({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b p-4 pb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">{children}</div>
      </ScrollArea>
    </div>
  )
}

export function SettingsExtensions() {
  const { t } = useT()
  const [tab, setTab] = useState<"extensions" | "plugins">("extensions")
  return (
    <SettingsPane title={t("options.extensions.title")}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "plugins") {
            setTab(value)
          } else {
            setTab("extensions")
          }
        }}
        className="flex min-h-0 flex-col"
      >
        <TabsList className="mb-4 shrink-0 self-start">
          <TabsTrigger value="extensions">
            {t("externalTools.tab.extensions")}
          </TabsTrigger>
          <TabsTrigger value="plugins">
            {t("externalTools.tab.plugins")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="extensions">
          <ExtensionsTab />
        </TabsContent>
        <TabsContent value="plugins">
          <PluginsTab />
        </TabsContent>
      </Tabs>
    </SettingsPane>
  )
}
