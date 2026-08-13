import type {
  ManagedAppOutputRecord,
  ManagedAppSummary,
  ManagedAppToolPreset,
} from "@amiba/managed-apps/types"
import type { ManagedAppsBridge } from "@amiba/managed-apps/bridge"
import type { ExtensionRegistryItem } from "@amiba/extension-host/preload"
import { McpAppsView } from "@amiba/mcp-host/react"
import { useT } from "@amiba/i18n"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Hammer,
  LoaderCircle,
  Pin,
  Play,
  RotateCcw,
  Settings2,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  WandSparkles,
} from "lucide-react"
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  cn,
} from "../primitives"
import { useResolvedTheme } from "../theme"
import type { StartAgentTask } from "./capabilities"

function statusTone(status: ManagedAppSummary["userStatus"]): string {
  if (status === "ready") return "bg-[hsl(var(--success))]"
  if (status === "needs-confirmation" || status === "preview-ready") return "bg-amber-500"
  if (status === "update-failed" || status === "unavailable") return "bg-destructive"
  return "bg-muted-foreground/55"
}

function statusKey(status: ManagedAppSummary["userStatus"]) {
  return `options.extensions.managed.status.${status}` as const
}

function permissionLabel(permission: string, language: string): string {
  const chinese = language.toLowerCase().startsWith("zh")
  const known: Record<string, [string, string]> = {
    camera: ["使用摄像头", "Use the camera"],
    microphone: ["使用麦克风", "Use the microphone"],
    geolocation: ["使用位置信息", "Use your location"],
    "clipboard-write": ["写入剪贴板", "Write to the clipboard"],
    "open-external": ["打开外部链接", "Open external links"],
    "agent:message": ["向 AI 发起请求", "Send requests to AI"],
    storage: ["保存小应用数据", "Store Applet data"],
    notifications: ["发送通知", "Send notifications"],
    subprocess: ["运行本地进程", "Run local processes"],
  }
  if (known[permission]) return known[permission]![chinese ? 0 : 1]
  if (permission.startsWith("network:")) {
    const origin = permission.slice("network:".length)
    return chinese ? `访问网络：${origin}` : `Access network: ${origin}`
  }
  if (permission.startsWith("filesystem:")) {
    return chinese ? "访问你授权的文件" : "Access files you authorize"
  }
  return chinese ? "使用额外能力" : "Use an additional capability"
}

function isRollbackIntent(request: string): boolean {
  const value = request.trim().toLocaleLowerCase()
  return /^(改坏了|撤销(上一次|上次|刚才)?(修改|更新)?|恢复(到)?(刚才|上一次|上次|之前)(可用的状态|的版本|版本)?|回到(刚才|上一次|上次|之前)|undo( the)? last( change| update)?|roll ?back|revert( to)? (the )?(last|previous)( change| version)?)\s*[。.!！]?$/.test(value)
}

function ManagedGlyph({ busy = false }: { busy?: boolean }) {
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-background text-foreground/75">
      {busy ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
    </span>
  )
}

function defaultValueForSchema(schema: Record<string, unknown>): unknown {
  if ("default" in schema) return schema.default
  if (schema.type === "boolean") return false
  if (schema.type === "number" || schema.type === "integer") return 0
  if (schema.type === "array") return []
  if (schema.type === "object") return {}
  return ""
}

function HeadlessToolRunner({
  app,
  bridge,
  candidate = false,
}: {
  app: ManagedAppSummary
  bridge: ManagedAppsBridge
  candidate?: boolean
}) {
  const { t } = useT()
  const revision = candidate ? app.candidateRevision : app.activeRevision
  const tools = revision?.capabilities?.tools ?? []
  const [selectedName, setSelectedName] = useState(tools[0]?.name ?? "")
  const selected = tools.find((tool) => tool.name === selectedName) ?? tools[0]
  const schema = (selected?.inputSchema ?? {}) as Record<string, unknown>
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [raw, setRaw] = useState("{}")
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [presets, setPresets] = useState<ManagedAppToolPreset[]>([])
  const [presetName, setPresetName] = useState("")

  useEffect(() => {
    if (!tools.some((tool) => tool.name === selectedName)) {
      setSelectedName(tools[0]?.name ?? "")
    }
  }, [selectedName, tools])

  useEffect(() => {
    const next = Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, defaultValueForSchema(property)]),
    )
    setValues(next)
    setRaw(JSON.stringify(next, null, 2))
    setResult(null)
    setError(null)
  }, [revision?.id, selectedName])

  useEffect(() => {
    void bridge.listPresets(app.id).then(setPresets).catch(() => setPresets([]))
  }, [app.id, bridge])

  if (!selected) return null
  const [providerAlias, ...toolParts] = selected.name.split("/")
  const toolName = toolParts.join("/")
  const matchingPresets = presets.filter(
    (preset) => preset.providerAlias === providerAlias && preset.toolName === toolName,
  )

  function applyPreset(presetId: string) {
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) return
    setValues(preset.arguments)
    setRaw(JSON.stringify(preset.arguments, null, 2))
  }

  async function savePreset() {
    if (!presetName.trim() || !revision) return
    try {
      const args = advanced ? JSON.parse(raw) as Record<string, unknown> : values
      const preset = await bridge.savePreset(app.id, {
        revisionId: revision.id,
        providerAlias,
        toolName,
        name: presetName,
        arguments: args,
      })
      setPresets((current) => [preset, ...current])
      setPresetName("")
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const args = advanced ? JSON.parse(raw) as Record<string, unknown> : values
      setResult(await bridge.callTool({
        appId: app.id,
        providerAlias,
        name: toolName,
        arguments: args,
        revisionId: candidate ? revision?.id : undefined,
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border/70">
      <div className="grid min-h-[390px] grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r border-border/60 bg-muted/20 p-2">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("options.extensions.managed.tools")}</p>
          {tools.map((tool) => (
            <button key={tool.name} type="button" onClick={() => setSelectedName(tool.name)} className={cn("mt-0.5 w-full rounded-lg px-2.5 py-2 text-left text-sm", tool.name === selected.name ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/65 hover:text-foreground")}>
              <span className="block truncate">{tool.name.split("/").slice(1).join("/")}</span>
              {tool.description ? <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 opacity-75">{tool.description}</span> : null}
            </button>
          ))}
        </aside>
        <div className="min-w-0 p-5">
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium">{toolName}</h3>{selected.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{selected.description}</p> : null}</div><div className="flex items-center gap-2">{matchingPresets.length ? <select aria-label={t("options.extensions.managed.presets")} defaultValue="" onChange={(event) => applyPreset(event.target.value)} className="h-7 max-w-40 rounded-md border border-border/70 bg-background px-2 text-xs"><option value="" disabled>{t("options.extensions.managed.presets")}</option>{matchingPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select> : null}<button type="button" onClick={() => setAdvanced((value) => !value)} className="text-xs text-muted-foreground hover:text-foreground">{advanced ? t("options.extensions.managed.formMode") : "JSON"}</button></div></div>
          {advanced ? (
            <Textarea value={raw} onChange={(event) => setRaw(event.target.value)} className="mt-4 min-h-44 font-mono text-xs" />
          ) : (
            <div className="mt-4 grid gap-4">
              {Object.entries(properties).length === 0 ? <p className="rounded-lg bg-muted/25 px-3 py-4 text-xs text-muted-foreground">{t("options.extensions.managed.noInputs")}</p> : Object.entries(properties).map(([name, property]) => (
                <div key={name} className="space-y-1.5">
                  <Label htmlFor={`tool-${name}`} className="text-xs">{String(property.title ?? name)}</Label>
                  {property.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm"><input id={`tool-${name}`} type="checkbox" checked={values[name] === true} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.checked }))} />{String(property.description ?? name)}</label>
                  ) : Array.isArray(property.enum) ? (
                    <select id={`tool-${name}`} value={String(values[name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} className="h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-sm">
                      {property.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                    </select>
                  ) : property.type === "array" || property.type === "object" ? (
                    <Textarea key={`${revision?.id}:${name}`} id={`tool-${name}`} className="min-h-24 font-mono text-xs" defaultValue={JSON.stringify(values[name] ?? defaultValueForSchema(property), null, 2)} onBlur={(event) => {
                      try {
                        const parsed = JSON.parse(event.target.value)
                        setValues((current) => ({ ...current, [name]: parsed }))
                        setError(null)
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : String(cause))
                      }
                    }} />
                  ) : (
                    <Input id={`tool-${name}`} type={property.type === "number" || property.type === "integer" ? "number" : "text"} value={String(values[name] ?? "")} placeholder={typeof property.description === "string" ? property.description : undefined} onChange={(event) => setValues((current) => ({ ...current, [name]: property.type === "number" || property.type === "integer" ? Number(event.target.value) : event.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}
          <Button className="mt-4" size="sm" disabled={busy} onClick={() => void run()}>{busy ? <LoaderCircle className="animate-spin" /> : <Play />}{t("options.extensions.managed.run")}</Button>
          {!candidate ? <div className="mt-4 flex max-w-sm items-center gap-2"><Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={t("options.extensions.managed.presetName")} className="h-8 text-xs" /><Button variant="outline" size="sm" disabled={!presetName.trim()} onClick={() => void savePreset()}>{t("options.extensions.managed.savePreset")}</Button></div> : null}
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          {result ? <pre data-selection="text" className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 font-mono text-xs leading-5">{JSON.stringify(result, null, 2)}</pre> : null}
        </div>
      </div>
    </section>
  )
}

function ManagedOutputs({ appId, bridge }: { appId: string; bridge: ManagedAppsBridge }) {
  const { t } = useT()
  const [outputs, setOutputs] = useState<ManagedAppOutputRecord[]>([])
  useEffect(() => {
    const load = () => {
      void bridge.listOutputs(appId).then(setOutputs).catch(() => setOutputs([]))
    }
    load()
    return bridge.onChanged((changedAppId) => {
      if (changedAppId === null || changedAppId === appId) load()
    })
  }, [appId, bridge])
  if (!outputs.length) return null
  return (
    <section className="mt-6 border-t border-border/60 pt-4">
      <h3 className="text-sm font-medium">{t("options.extensions.managed.outputs")}</h3>
      <ul className="mt-2 grid gap-1 md:grid-cols-2">
        {outputs.slice(0, 12).map((output) => (
          <li key={output.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/30">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{output.name}</span><span className="block truncate text-[11px] text-muted-foreground">{output.uri}</span></span>
            <Button variant="ghost" size="icon" className="h-7 w-7" title={output.pinned ? t("options.extensions.managed.unpin") : t("options.extensions.managed.pin")} onClick={() => void bridge.updateOutput(appId, output.id, { pinned: !output.pinned }).then((updated) => setOutputs((current) => current.map((item) => item.id === updated.id ? updated : item)))}><Pin className={cn("h-3.5 w-3.5", output.pinned && "fill-current")} /></Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ManagedAppletCreateDialog({
  open,
  onOpenChange,
  bridge,
  startAgentTask,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bridge: ManagedAppsBridge
  startAgentTask?: StartAgentTask
}) {
  const { t } = useT()
  const [name, setName] = useState("")
  const [request, setRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || !request.trim() || !startAgentTask) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.create({ name, request, description: request })
      const sessionId = await startAgentTask(result.agentPrompt, {
        sourceApp: name.trim(),
        workspacePath: result.draft.workspacePath,
      })
      if (typeof sessionId === "string") {
        await bridge.attachSession(result.app.id, result.draft.id, sessionId)
      }
      setName("")
      setRequest("")
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("options.extensions.managed.create.title")}</DialogTitle>
          <DialogDescription>{t("options.extensions.managed.create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="managed-applet-name">{t("options.extensions.managed.create.name")}</Label>
            <Input
              id="managed-applet-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("options.extensions.managed.create.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="managed-applet-request">{t("options.extensions.managed.create.request")}</Label>
            <Textarea
              id="managed-applet-request"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder={t("options.extensions.managed.create.requestPlaceholder")}
              className="min-h-28 resize-none"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={busy || !name.trim() || !request.trim() || !startAgentTask} onClick={() => void create()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
            {t("options.extensions.managed.create.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ManagedAppletDetail({
  app,
  bridge,
  startAgentTask,
  onBack,
  onRefresh,
}: {
  app: ManagedAppSummary
  bridge: ManagedAppsBridge
  startAgentTask?: StartAgentTask
  onBack: () => void
  onRefresh: () => void
}) {
  const { t, language } = useT()
  const { theme } = useResolvedTheme()
  const [surface, setSurface] = useState<Awaited<ReturnType<ManagedAppsBridge["surface"]>>>(null)
  const [loadingSurface, setLoadingSurface] = useState(false)
  const [improveOpen, setImproveOpen] = useState(false)
  const [request, setRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [tagsInput, setTagsInput] = useState(app.tags.join(", "))
  const [collectionInput, setCollectionInput] = useState(app.collectionId ?? "")
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [surfaceName, setSurfaceName] = useState<"main" | "settings">("main")
  const candidate = app.userStatus === "needs-confirmation"
  const targetRevision = candidate ? app.candidateRevision : app.activeRevision
  const addedPermissions = candidate
    ? app.candidateRevision?.permissions.filter(
        (permission) => !app.activeRevision?.permissions.includes(permission),
      ) ?? []
    : []

  const loadSurface = useCallback(async () => {
    if (!app.activeRevisionId && !app.candidateRevision) return
    setLoadingSurface(true)
    try {
      const next = await bridge.surface(
        app.id,
        candidate ? "candidate" : "active",
        surfaceName,
      )
      setSurface(next)
      if (!candidate && app.activeRevisionId) await bridge.markUsed(app.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingSurface(false)
    }
  }, [app.activeRevisionId, app.candidateRevision, app.id, bridge, candidate, surfaceName])

  useEffect(() => {
    void loadSurface()
  }, [loadSurface])

  useEffect(() => {
    if (!targetRevision?.manifest.surfaces?.main && targetRevision?.manifest.surfaces?.settings) {
      setSurfaceName("settings")
    }
  }, [targetRevision?.id])

  async function improve() {
    if (!request.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (app.activeRevision?.parentRevisionId && isRollbackIntent(request)) {
        await bridge.rollback(app.id)
        setImproveOpen(false)
        setRequest("")
        onRefresh()
        return
      }
      if (!startAgentTask) return
      const result = await bridge.requestChange(app.id, request)
      const sessionId = await startAgentTask(result.agentPrompt, {
        sourceApp: app.name,
        workspacePath: result.draft.workspacePath,
      })
      if (typeof sessionId === "string") {
        await bridge.attachSession(app.id, result.draft.id, sessionId)
      }
      setImproveOpen(false)
      setRequest("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function action(run: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await run()
      onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const providerAlias = String(surface?.metadata?.provider ?? app.candidateRevision?.manifest.mcp?.providers[0]?.alias ?? app.activeRevision?.manifest.mcp?.providers[0]?.alias ?? "main")

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-5">
      <button type="button" onClick={onBack} className="-ml-2 mb-4 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted/55 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t("options.extensions.title")}
      </button>

      <div className="flex items-start gap-3">
        <ManagedGlyph busy={app.userStatus === "creating" || app.userStatus === "improving"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="truncate text-lg font-normal tracking-[-0.01em]">{app.name}</h1>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", statusTone(app.userStatus))} />
              {t(statusKey(app.userStatus))}
            </span>
          </div>
          {app.description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{app.description}</p> : null}
        </div>
        <Button variant="outline" size="sm" disabled={busy || !startAgentTask || app.userStatus === "creating" || app.userStatus === "improving" || candidate} onClick={() => setImproveOpen(true)}>
          <WandSparkles />
          {t("options.extensions.managed.improve")}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title={app.pinned ? t("options.extensions.managed.unpin") : t("options.extensions.managed.pin")} onClick={() => void action(() => bridge.updateMetadata(app.id, { pinned: !app.pinned }))}>
          <Pin className={cn("h-3.5 w-3.5", app.pinned && "fill-current text-foreground")} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title={t("options.extensions.managed.organize")} onClick={() => setOrganizeOpen(true)}><Tag className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title={t("options.extensions.managed.export")} onClick={() => void bridge.exportProject(app.id).then(setExportedPath)}>
          <Share2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={t("options.extensions.managed.delete")} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {exportedPath ? <p className="mt-3 text-xs text-muted-foreground">{t("options.extensions.managed.exported", { path: exportedPath })}</p> : null}
      {app.tags.length || app.collectionId ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {app.collectionId ? <span className="rounded-md bg-muted/55 px-2 py-1">{app.collectionId}</span> : null}
          {app.tags.map((tag) => <span key={tag} className="rounded-md bg-muted/35 px-2 py-1">#{tag}</span>)}
        </div>
      ) : null}

      {app.latestChangeSummary ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-muted/30 px-3.5 py-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
          <div><p className="text-xs text-muted-foreground">{t("options.extensions.managed.latestChange")}</p><p className="mt-0.5 leading-5">{app.latestChangeSummary}</p></div>
        </div>
      ) : null}

      {app.lastError || error ? (
        <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl bg-destructive/[0.055] px-3.5 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p>{app.activeRevisionId ? t("options.extensions.managed.failedSafe") : t("options.extensions.managed.failed")}</p><p className="mt-1 text-xs opacity-85">{error ?? app.lastError}</p></div>
        </div>
      ) : null}

      {candidate ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/[0.08] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t("options.extensions.managed.confirm.title")}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("options.extensions.managed.confirm.description")}</p>{addedPermissions.length ? <div className="mt-2 flex flex-wrap gap-1.5">{[...new Set(addedPermissions.map((permission) => permissionLabel(permission, language)))].map((label) => <span key={label} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-foreground/80">{label}</span>)}</div> : null}</div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(() => bridge.reject(app.id, app.candidateRevision!.id))}>{t("options.extensions.managed.keepCurrent")}</Button>
          <Button size="sm" disabled={busy} onClick={() => void action(() => bridge.confirm(app.id, app.candidateRevision!.id))}>{t("common.confirm")}</Button>
        </div>
      ) : null}

      {loadingSurface || surface?.html || targetRevision?.manifest.surfaces?.[surfaceName] ? <section className="mt-6 overflow-hidden rounded-xl border border-border/70 bg-muted/10">
        <div className="flex h-10 items-center border-b border-border/60 px-3.5">
          <p className="text-xs text-muted-foreground">{candidate ? t("options.extensions.managed.previewCandidate") : t("options.extensions.managed.current")}</p>
          {targetRevision?.manifest.surfaces?.main && targetRevision.manifest.surfaces.settings ? <div className="ml-3 flex items-center rounded-md bg-muted/45 p-0.5"><button type="button" onClick={() => setSurfaceName("main")} className={cn("rounded px-2 py-1 text-[11px]", surfaceName === "main" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>{t("options.extensions.managed.mainSurface")}</button><button type="button" onClick={() => setSurfaceName("settings")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]", surfaceName === "settings" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}><Settings2 className="h-3 w-3" />{t("options.extensions.managed.settingsSurface")}</button></div> : null}
          {loadingSurface ? <LoaderCircle className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="h-[430px] bg-background">
          {surface?.html ? (
            <McpAppsView
              appId={app.id}
              providerAlias={providerAlias}
              html={surface.html}
              theme={theme}
              locale={language}
              permissions={(candidate ? app.candidateRevision : app.activeRevision)?.permissions}
              bridge={{
                callTool: (input) => bridge.callTool({
                  ...input,
                  revisionId: candidate ? app.candidateRevision?.id : undefined,
                }) as never,
                readResource: (input) => bridge.readResource({
                  ...input,
                  revisionId: candidate ? app.candidateRevision?.id : undefined,
                }) as never,
                openLink: (url) => window.open(url, "_blank", "noopener,noreferrer") ? Promise.resolve() : Promise.resolve(),
                sendMessage: async (text) => {
                  await startAgentTask?.(text, { sourceApp: app.name })
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loadingSurface ? t("common.loading") : t("options.extensions.managed.noSurface")}
            </div>
          )}
        </div>
      </section> : null}

      {!surface?.html && surfaceName === "main" && (targetRevision?.capabilities?.tools.length ?? 0) > 0 ? (
        <HeadlessToolRunner app={app} bridge={bridge} candidate={candidate} />
      ) : null}

      <ManagedOutputs appId={app.id} bridge={bridge} />

      {app.activeRevision?.parentRevisionId ? (
        <button type="button" disabled={busy} onClick={() => void action(() => bridge.rollback(app.id))} className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RotateCcw className="h-3.5 w-3.5" />
          {t("options.extensions.managed.undo")}
        </button>
      ) : null}

      <details className="mt-8 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">{t("options.extensions.managed.developerDetails")}</summary>
        <dl className="mt-3 grid gap-3 rounded-lg bg-muted/25 p-3 font-mono">
          <div><dt className="font-sans opacity-70">ID</dt><dd className="mt-1 break-all text-foreground">{app.id}</dd></div>
          <div><dt className="font-sans opacity-70">Runtime</dt><dd className="mt-1 text-foreground">{app.activeRevision?.manifest.runtime ?? "—"}</dd></div>
        </dl>
      </details>

      <Dialog open={improveOpen} onOpenChange={setImproveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("options.extensions.managed.improveTitle", { name: app.name })}</DialogTitle><DialogDescription>{t("options.extensions.managed.improveDescription")}</DialogDescription></DialogHeader>
          <Textarea value={request} onChange={(event) => setRequest(event.target.value)} placeholder={t("options.extensions.managed.improvePlaceholder")} className="min-h-32 resize-none" autoFocus />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter><Button variant="outline" onClick={() => setImproveOpen(false)}>{t("common.cancel")}</Button><Button disabled={busy || !request.trim()} onClick={() => void improve()}><Hammer />{t("options.extensions.managed.startImproving")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("options.extensions.managed.deleteTitle", { name: app.name })}</DialogTitle><DialogDescription>{t("options.extensions.managed.deleteDescription")}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void (async () => { await action(() => bridge.archive(app.id)); setDeleteOpen(false); onBack() })()}>{t("options.extensions.managed.delete")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={organizeOpen} onOpenChange={setOrganizeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("options.extensions.managed.organize")}</DialogTitle><DialogDescription>{t("options.extensions.managed.organizeDescription")}</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-2"><Label htmlFor="managed-collection">{t("options.extensions.managed.collection")}</Label><Input id="managed-collection" value={collectionInput} onChange={(event) => setCollectionInput(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="managed-tags">{t("options.extensions.managed.tags")}</Label><Input id="managed-tags" value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder={t("options.extensions.managed.tagsPlaceholder")} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setOrganizeOpen(false)}>{t("common.cancel")}</Button><Button onClick={() => void (async () => { await action(() => bridge.updateMetadata(app.id, { collectionId: collectionInput, tags: tagsInput.split(/[,，]/) })); setOrganizeOpen(false) })()}>{t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ManagedApplets({
  bridge,
  startAgentTask,
  refreshToken = 0,
  onRefreshingChange,
  onDetailChange,
  installedItems = [],
  installedReady = true,
  renderInstalledItem,
}: {
  bridge: ManagedAppsBridge
  startAgentTask?: StartAgentTask
  refreshToken?: number
  onRefreshingChange?: (refreshing: boolean) => void
  onDetailChange?: (open: boolean) => void
  installedItems?: ExtensionRegistryItem[]
  installedReady?: boolean
  renderInstalledItem?: (item: ExtensionRegistryItem) => ReactNode
}) {
  const { t } = useT()
  const [apps, setApps] = useState<ManagedAppSummary[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState<"all" | "ai" | ExtensionRegistryItem["source"]>("all")

  const refresh = useCallback(async () => {
    onRefreshingChange?.(true)
    try {
      setApps(await bridge.list({ includeArchived: true }))
      setLoadError(null)
      setReady(true)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
      setReady(true)
    } finally {
      onRefreshingChange?.(false)
    }
  }, [bridge, onRefreshingChange])

  useEffect(() => { void refresh() }, [refresh, refreshToken])
  useEffect(() => bridge.onChanged(() => void refresh()), [bridge, refresh])

  const selected = apps.find((app) => app.id === selectedId)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const activeApps = apps.filter((app) => !app.archived)
  const visibleApps = activeApps.filter((app) => {
    if (sourceFilter !== "all" && sourceFilter !== "ai") return false
    return !normalizedQuery || [app.name, app.description, app.latestChangeSummary, ...app.tags]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery))
  })
  const visibleInstalledItems = installedItems.filter((item) => {
    if (sourceFilter !== "all" && sourceFilter !== item.source) return false
    if (!normalizedQuery) return true
    return [item.id, item.manifest?.name, item.version, item.source]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery))
  })
  const archivedApps = apps.filter((app) => app.archived)
  const sourceCounts = {
    ai: activeApps.length,
    local: installedItems.filter((item) => item.source === "local").length,
    marketplace: installedItems.filter((item) => item.source === "marketplace").length,
    bundled: installedItems.filter((item) => item.source === "bundled").length,
  }
  const sourceOptions = [
    { id: "all" as const, label: t("options.extensions.filter.all") },
    ...(sourceCounts.ai ? [{ id: "ai" as const, label: t("options.extensions.filter.aiCreated") }] : []),
    ...(sourceCounts.local ? [{ id: "local" as const, label: t("options.extensions.source.local") }] : []),
    ...(sourceCounts.marketplace ? [{ id: "marketplace" as const, label: t("options.extensions.source.marketplace") }] : []),
    ...(sourceCounts.bundled ? [{ id: "bundled" as const, label: t("options.extensions.source.bundled") }] : []),
  ]
  const unifiedEntries = [
    ...visibleApps.map((app) => ({
      key: `managed:${app.id}`,
      name: app.name,
      pinned: app.pinned,
      content: (
        <li>
          <button type="button" onClick={() => setSelectedId(app.id)} className="group flex min-h-[72px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/45">
            <ManagedGlyph busy={app.userStatus === "creating" || app.userStatus === "improving"} />
            <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{app.name}</span><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusTone(app.userStatus))} /></span><span className="mt-1 block truncate text-xs text-muted-foreground">{t(statusKey(app.userStatus))}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
          </button>
        </li>
      ),
    })),
    ...visibleInstalledItems.map((item) => ({
      key: `installed:${item.id}`,
      name: item.manifest?.name ?? item.id,
      pinned: false,
      content: renderInstalledItem?.(item) ?? null,
    })),
  ].sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.name.localeCompare(right.name))
  const totalActive = activeApps.length + installedItems.length
  const libraryReady = ready && installedReady
  useEffect(() => {
    onDetailChange?.(!!selected)
    return () => onDetailChange?.(false)
  }, [onDetailChange, selected])
  if (selected) {
    return <ManagedAppletDetail app={selected} bridge={bridge} startAgentTask={startAgentTask} onBack={() => setSelectedId(null)} onRefresh={() => void refresh()} />
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-2 pb-1">
        <div><h3 className="text-sm font-normal">{t("options.extensions.managed.yours")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("options.extensions.managed.yoursDescription")}</p></div>
        {totalActive ? <span className="text-sm tabular-nums text-muted-foreground">{totalActive}</span> : null}
      </div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("options.extensions.managed.search")} className="mb-3 h-9" />
      {sourceOptions.length > 2 ? (
        <div role="group" aria-label={t("options.extensions.filter.label")} className="mb-3 flex flex-wrap gap-1">
          {sourceOptions.map((option) => (
            <button key={option.id} type="button" aria-pressed={sourceFilter === option.id} onClick={() => setSourceFilter(option.id)} className={cn("inline-flex h-7 items-center rounded-full border px-3 text-xs transition-colors", sourceFilter === option.id ? "border-foreground/10 bg-muted font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>{option.label}</button>
          ))}
        </div>
      ) : null}
      {loadError ? <div role="alert" className="mb-3 rounded-xl bg-destructive/[0.055] px-3.5 py-3 text-sm text-destructive"><p>{t("options.extensions.managed.serviceUnavailable")}</p><details className="mt-1 text-xs opacity-75"><summary className="cursor-pointer">{t("options.extensions.managed.developerDetails")}</summary><p className="mt-1 break-all font-mono">{loadError}</p></details></div> : null}
      {!libraryReady && unifiedEntries.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center"><LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : unifiedEntries.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-muted/20 px-6 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground/45" />
          <p className="mt-3 text-sm">{normalizedQuery || sourceFilter !== "all" ? t("options.extensions.managed.noSearchResults") : t("options.extensions.managed.empty")}</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{normalizedQuery || sourceFilter !== "all" ? t("options.extensions.managed.noSearchResultsDescription") : t("options.extensions.managed.emptyDescription")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
          {unifiedEntries.map((entry) => <Fragment key={entry.key}>{entry.content}</Fragment>)}
        </ul>
      )}
      {archivedApps.length ? (
        <details className="mt-6 border-t border-border/60 pt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("options.extensions.managed.recentlyDeleted", { count: archivedApps.length })}</summary>
          <ul className="mt-2 space-y-1">
            {archivedApps.map((app) => (
              <li key={app.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{app.name}</span>
                <Button variant="ghost" size="sm" onClick={() => void bridge.restore(app.id).then(refresh)}>{t("options.extensions.managed.restore")}</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
