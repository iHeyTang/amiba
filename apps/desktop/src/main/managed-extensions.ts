import http from "node:http"
import { extname, join, relative, resolve, sep } from "node:path"
import { appendFile, cp, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises"

import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import {
  createManagedExtensionService,
  type ManagedExtensionDraftPreview,
  type ManagedExtensionService,
} from "@amiba/managed-extensions"
import {
  createManagedMcpRuntime,
} from "@amiba/mcp-host/runtime"
import type { ManagedMcpRuntime } from "@amiba/mcp-host/types"
import type { McpToolResult } from "@amiba/mcp-host/types"
import {
  startAmibaExtensionBridgeServer,
  type AmibaHostTool,
} from "@amiba/mcp-host/extension-bridge"

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
}

export interface ManagedExtensionsController {
  service: ManagedExtensionService
  runtime: ManagedMcpRuntime
  extensionBridgeUrl: string
  extensionBridgeToken: string
  stop(): Promise<void>
}

function outputsFromToolResult(event: {
  revisionId: string
  providerAlias: string
  toolName: string
  result: McpToolResult
}) {
  return event.result.content.flatMap((content) => {
    if (content.type === "resource_link" && typeof content.uri === "string") {
      return [{
        revisionId: event.revisionId,
        uri: content.uri,
        name: typeof content.name === "string" ? content.name : content.uri,
        mimeType: typeof content.mimeType === "string" ? content.mimeType : undefined,
        kind: "resource" as const,
        toolName: `${event.providerAlias}/${event.toolName}`,
      }]
    }
    if (content.type === "resource" && content.resource && typeof content.resource === "object") {
      const resource = content.resource as Record<string, unknown>
      if (typeof resource.uri !== "string") return []
      return [{
        revisionId: event.revisionId,
        uri: resource.uri,
        name: typeof resource.name === "string" ? resource.name : resource.uri,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
        kind: "resource" as const,
        toolName: `${event.providerAlias}/${event.toolName}`,
      }]
    }
    return []
  })
}

function cspFor(origin: string, permissions: string[]): string {
  const network = permissions
    .filter((permission) => permission.startsWith("network:"))
    .map((permission) => permission.slice("network:".length))
    .flatMap((value) => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === "https:" && parsed.origin === value ? [parsed.origin] : []
      } catch {
        return []
      }
    })
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `media-src ${origin} data: blob:`,
    `connect-src ${[origin, ...network].join(" ")}`,
    "frame-src 'none'",
    "object-src 'none'",
    `base-uri ${origin}`,
  ].join("; ")
}

function decorateHtml(html: string, assetBase: string, permissions: string[]): string {
  const origin = new URL(assetBase).origin
  const tags = [
    `<meta http-equiv="Content-Security-Policy" content="${cspFor(origin, permissions)}">`,
    `<base href="${assetBase}">`,
  ].join("")
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${tags}`)
  }
  return `${tags}${html}`
}

async function startAssetsServer(service: ManagedExtensionService): Promise<{
  url(): string
  stop(): Promise<void>
}> {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost")
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
      if (parts.length < 4 || parts[0] !== "assets") {
        response.writeHead(404).end("Not Found")
        return
      }
      const [, extensionId, revisionId, ...assetParts] = parts
      const path = await service.resolveAsset(extensionId, revisionId, assetParts.join("/"))
      if (!path) {
        response.writeHead(404).end("Not Found")
        return
      }
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Content-Type": MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      })
      response.end(await readFile(path))
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("managed assets server has no port")
  const base = `http://127.0.0.1:${address.port}`
  return {
    url: () => base,
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

interface DraftPreviewServer {
  url(): string
  stop(): Promise<void>
}

function previewAssetPath(rootPath: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const parts = decoded.replaceAll("\\", "/").split("/").filter(Boolean)
  if (parts.some((part) => part === "." || part === ".." || part.startsWith("."))) {
    return null
  }
  const candidate = resolve(rootPath, ...parts)
  const safeRoot = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
  return candidate === rootPath || candidate.startsWith(safeRoot) ? candidate : null
}

async function startDraftPreviewServer(
  preview: ManagedExtensionDraftPreview & { entry: string },
): Promise<DraftPreviewServer> {
  const rootPath = resolve(preview.workspacePath)
  const realRootPath = await realpath(rootPath)
  const requestedEntryPath = resolve(rootPath, preview.entry)
  const entryPath = await realpath(requestedEntryPath)
  const safeRealRoot = realRootPath.endsWith(sep) ? realRootPath : `${realRootPath}${sep}`
  if (entryPath !== realRootPath && !entryPath.startsWith(safeRealRoot)) {
    throw new Error("draft preview entry must stay inside its workspace")
  }
  const relativeEntry = relative(rootPath, requestedEntryPath).split(sep).join("/")
  let base = ""
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed")
        return
      }
      const url = new URL(request.url ?? "/", "http://localhost")
      let path = previewAssetPath(rootPath, url.pathname)
      if (!path) {
        response.writeHead(404).end("Not Found")
        return
      }
      const info = await stat(path).catch(() => null)
      if (info?.isDirectory()) {
        path = previewAssetPath(rootPath, `${url.pathname.replace(/\/$/, "")}/index.html`)
      }
      const resolvedPath = path ? await realpath(path).catch(() => null) : null
      if (
        !resolvedPath ||
        (resolvedPath !== realRootPath && !resolvedPath.startsWith(safeRealRoot)) ||
        !(await stat(resolvedPath).catch(() => null))?.isFile()
      ) {
        response.writeHead(404).end("Not Found")
        return
      }
      path = resolvedPath
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      }
      response.writeHead(200, headers)
      if (request.method === "HEAD") {
        response.end()
        return
      }
      if (path === entryPath && extname(path).toLowerCase() === ".html") {
        const html = await readFile(path, "utf8")
        response.end(decorateHtml(html, `${base}/`, preview.manifest.permissions ?? []))
        return
      }
      response.end(await readFile(path))
    } catch {
      response.writeHead(500).end("Preview failed")
    }
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("draft preview server has no port")
  base = `http://127.0.0.1:${address.port}`
  const entryUrl = `${base}/${relativeEntry.split("/").map(encodeURIComponent).join("/")}`
  return {
    url: () => entryUrl,
    stop: () => new Promise((resolveStop, reject) => {
      server.close((error) => error ? reject(error) : resolveStop())
    }),
  }
}

function sendChanged(extensionId: string | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("managed-extensions:changed", extensionId)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function stableDataPath(root: string, extensionId: string): string {
  return join(root, extensionId, "data")
}

function candidateDataPath(root: string, extensionId: string, revisionId: string): string {
  return join(root, extensionId, "candidate-data", revisionId)
}

function backupDataPath(root: string, extensionId: string, revisionId: string): string {
  return join(root, extensionId, "data-backups", revisionId)
}

async function seedCandidateData(root: string, extensionId: string, revisionId: string): Promise<void> {
  const source = stableDataPath(root, extensionId)
  const destination = candidateDataPath(root, extensionId, revisionId)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(root, extensionId, "candidate-data"), { recursive: true })
  if (await pathExists(source)) await cp(source, destination, { recursive: true })
  else await mkdir(destination, { recursive: true })
}

async function seedHistoricalData(root: string, extensionId: string, revisionId: string): Promise<void> {
  const source = backupDataPath(root, extensionId, revisionId)
  if (!(await pathExists(source))) {
    throw new Error("The data snapshot for this Extension revision is no longer available")
  }
  const destination = candidateDataPath(root, extensionId, revisionId)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(root, extensionId, "candidate-data"), { recursive: true })
  await cp(source, destination, { recursive: true })
}

async function snapshotData(
  root: string,
  extensionId: string,
  revisionId: string | undefined,
): Promise<void> {
  if (!revisionId) return
  const source = stableDataPath(root, extensionId)
  const destination = backupDataPath(root, extensionId, revisionId)
  const temporary = `${destination}.${Date.now()}.tmp`
  await mkdir(join(root, extensionId, "data-backups"), { recursive: true })
  await rm(temporary, { recursive: true, force: true })
  if (await pathExists(source)) await cp(source, temporary, { recursive: true })
  else await mkdir(temporary, { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
}

async function activateWithData(
  root: string,
  runtime: ManagedMcpRuntime,
  input: Parameters<ManagedMcpRuntime["activate"]>[0],
): Promise<void> {
  const { extensionId, revision, previous } = input
  const stable = stableDataPath(root, extensionId)
  const candidate = candidateDataPath(root, extensionId, revision.id)
  const backup = backupDataPath(root, extensionId, revision.id)
  const incoming = (await pathExists(candidate))
    ? candidate
    : previous && previous.id !== revision.id && (await pathExists(backup))
      ? backup
      : null
  if (!incoming) {
    await mkdir(stable, { recursive: true })
    await runtime.activate(input)
    return
  }

  await snapshotData(root, extensionId, previous?.id)
  const staged = incoming === candidate
    ? candidate
    : join(root, extensionId, "candidate-data", `${revision.id}-restore-${Date.now()}`)
  if (incoming !== candidate) {
    await mkdir(join(root, extensionId, "candidate-data"), { recursive: true })
    await cp(incoming, staged, { recursive: true })
  }
  const displaced = join(root, extensionId, `data-displaced-${Date.now()}`)
  const hadStable = await pathExists(stable)
  if (hadStable) await rename(stable, displaced)
  await rename(staged, stable)
  try {
    await runtime.activate(input)
    await rm(displaced, { recursive: true, force: true })
  } catch (error) {
    if (incoming === candidate && (await pathExists(stable))) {
      await rename(stable, candidate)
    } else {
      await rm(stable, { recursive: true, force: true })
    }
    if (hadStable && (await pathExists(displaced))) await rename(displaced, stable)
    throw error
  }
}

export async function startManagedExtensionsController(options: {
  root: string
  pythonCommand?: string
  hostTools?: readonly AmibaHostTool[]
  openBrowser?: (url: string) => Promise<unknown>
  resolveRegisteredProvider?: NonNullable<Parameters<typeof createManagedMcpRuntime>[0]>["resolveRegisteredProvider"]
}): Promise<ManagedExtensionsController> {
  let serviceRef: ManagedExtensionService | null = null
  const runtime = createManagedMcpRuntime({
    resolveRegisteredProvider: options.resolveRegisteredProvider,
    resolveDataPath: (extensionId, revisionId, mode) => mode === "active"
      ? stableDataPath(options.root, extensionId)
      : candidateDataPath(options.root, extensionId, revisionId),
    onToolCall: (event) => {
      const auditRoot = join(options.root, ".audit")
      const path = join(auditRoot, `${new Date().toISOString().slice(0, 10)}.jsonl`)
      void mkdir(auditRoot, { recursive: true })
        .then(() => appendFile(path, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`, "utf8"))
        .catch((error) => console.warn("[managed-extensions] audit write failed:", error))
    },
    onToolResult: (event) => {
      const outputs = outputsFromToolResult(event)
      if (outputs.length) void serviceRef?.recordOutputs(event.extensionId, outputs)
    },
    resolveCommand: (kind) => {
      const env = Object.fromEntries(
        ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SystemRoot"]
          .map((key) => [key, process.env[key]])
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
      return kind === "python" && options.pythonCommand
        ? { command: options.pythonCommand, env }
        : kind === "node"
          ? { command: process.execPath, env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }
          : { command: "python3", env }
    },
  })
  const service = createManagedExtensionService({
    root: options.root,
    hooks: {
      discover: (input) => runtime.discover(input),
      validateCandidate: async (input) => {
        await seedCandidateData(options.root, input.extensionId, input.revision.id)
        await runtime.prepare(input)
      },
      activate: (input) => activateWithData(options.root, runtime, input),
      deactivate: (extensionId) => runtime.deactivate(extensionId),
      discardCandidate: async (extensionId, revisionId) => {
        await runtime.discardPrepared(extensionId, revisionId)
        await rm(candidateDataPath(options.root, extensionId, revisionId), {
          recursive: true,
          force: true,
        })
      },
    },
  })
  serviceRef = service
  await service.init()
  const assets = await startAssetsServer(service)
  let draftPreview: DraftPreviewServer | null = null
  const extensionBridge = await startAmibaExtensionBridgeServer(runtime, service, {
    tools: options.hostTools,
    previewDraft: async (input) => {
      const preview = await service.prepareDraftPreview(input.extensionId, input.draftId, {
        surfaceName: input.surfaceName,
        runTests: input.runTests,
      })
      const capabilityCounts = {
        tools: preview.capabilities.tools.length,
        resources: preview.capabilities.resources.length,
        resourceTemplates: preview.capabilities.resourceTemplates.length,
        prompts: preview.capabilities.prompts.length,
      }
      if (!preview.entry) {
        return {
          extension_id: preview.extensionId,
          draft_id: preview.draftId,
          surface: preview.surfaceName,
          browser_opened: false,
          capability_counts: capabilityCounts,
          message: `The draft has no static ${preview.surfaceName} surface. Build, tests, manifest, and MCP discovery passed; validate this headless Extension through its tests and discovered MCP capabilities.`,
        }
      }
      const nextPreview = await startDraftPreviewServer(preview as ManagedExtensionDraftPreview & { entry: string })
      const previousPreview = draftPreview
      draftPreview = nextPreview
      await previousPreview?.stop().catch(() => {})
      const previewUrl = nextPreview.url()
      const browser = options.openBrowser
        ? await options.openBrowser(previewUrl)
        : undefined
      return {
        extension_id: preview.extensionId,
        draft_id: preview.draftId,
        surface: preview.surfaceName,
        preview_url: previewUrl,
        browser_opened: browser !== undefined,
        browser,
        capability_counts: capabilityCounts,
        next_steps: [
          "Call amiba_browser_snapshot and amiba_browser_screenshot.",
          "Exercise the important controls with click/type/press/scroll.",
          "Call amiba_browser_console and fix every unexpected error.",
          "After source changes, call amiba_preview_extension_draft again.",
        ],
      }
    },
  })
  const unsubscribe = service.onChanged(sendChanged)
  const historicalOperations = new Map<string, Promise<unknown>>()

  async function readHistoricalResource(input: {
    extensionId: string
    revisionId: string
    providerAlias: string
    uri: string
  }) {
    const operationKey = `${input.extensionId}:${input.revisionId}`
    const previous = historicalOperations.get(operationKey) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const deployment = await service.revisionDeployment(input.extensionId, input.revisionId)
      if (!deployment) throw new Error("The referenced Extension revision is unavailable")
      await seedHistoricalData(options.root, input.extensionId, input.revisionId)
      await runtime.prepare({
        extensionId: input.extensionId,
        revision: deployment.revision,
        bundlePath: deployment.bundlePath,
      })
      try {
        return await runtime.readPreparedResource(
          input.extensionId,
          input.revisionId,
          input.providerAlias,
          input.uri,
        )
      } finally {
        await runtime.discardPrepared(input.extensionId, input.revisionId)
        await rm(candidateDataPath(options.root, input.extensionId, input.revisionId), {
          recursive: true,
          force: true,
        })
      }
    })
    historicalOperations.set(operationKey, operation)
    try {
      return await operation
    } finally {
      if (historicalOperations.get(operationKey) === operation) {
        historicalOperations.delete(operationKey)
      }
    }
  }

  const handle = <TArgs extends unknown[], TResult>(
    channel: string,
    listener: (...args: TArgs) => Promise<TResult> | TResult,
  ) => ipcMain.handle(channel, (_event, ...args: TArgs) => listener(...args))

  handle("managed-extensions:list", (listOptions?: { includeArchived?: boolean }) => service.list(listOptions))
  handle("managed-extensions:get", (extensionId: string) => service.get(extensionId))
  handle("managed-extensions:create", (request: Parameters<ManagedExtensionService["create"]>[0]) => service.create(request))
  handle("managed-extensions:request-change", (extensionId: string, request: string) => service.requestChange(extensionId, request))
  handle("managed-extensions:abort-draft", (extensionId: string, draftId: string, reason?: string) =>
    service.abortDraft(extensionId, draftId, reason),
  )
  handle("managed-extensions:attach-session", (extensionId: string, draftId: string, sessionId: string) =>
    service.attachSession(extensionId, draftId, sessionId),
  )
  handle("managed-extensions:update-metadata", (extensionId: string, patch: Parameters<ManagedExtensionService["updateMetadata"]>[1]) =>
    service.updateMetadata(extensionId, patch),
  )
  handle("managed-extensions:archive", (extensionId: string) => service.archive(extensionId))
  handle("managed-extensions:restore", (extensionId: string) => service.restore(extensionId))
  handle("managed-extensions:export", async (extensionId: string) => {
    const options = {
      title: "导出扩展项目",
      buttonLabel: "导出到这里",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    }
    const owner = BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const destination = await service.exportProject(extensionId, result.filePaths[0])
    shell.showItemInFolder(destination)
    return destination
  })
  handle("managed-extensions:list-outputs", (extensionId: string) => service.listOutputs(extensionId))
  handle("managed-extensions:update-output", (
    extensionId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ) => service.updateOutput(extensionId, outputId, patch))
  handle("managed-extensions:list-presets", (extensionId: string) => service.listPresets(extensionId))
  handle("managed-extensions:save-preset", (
    extensionId: string,
    input: Parameters<ManagedExtensionService["savePreset"]>[1],
  ) => service.savePreset(extensionId, input))
  handle("managed-extensions:delete-preset", (extensionId: string, presetId: string) =>
    service.deletePreset(extensionId, presetId),
  )
  handle("managed-extensions:confirm", (extensionId: string, revisionId: string) => service.confirm(extensionId, revisionId))
  handle("managed-extensions:reject", (extensionId: string, revisionId: string) => service.reject(extensionId, revisionId))
  handle("managed-extensions:rollback", (extensionId: string) => service.rollback(extensionId))
  handle("managed-extensions:mark-used", (extensionId: string) => service.markUsed(extensionId))
  handle("managed-extensions:surface", async (
    extensionId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ) => {
    const document = await service.surface(extensionId, target, surfaceName)
    if (!document) return null
    const summary = await service.get(extensionId)
    const revision = target === "candidate" ? summary?.candidateRevision : summary?.activeRevision
    if (document.html) {
      const assetBase = `${assets.url()}/assets/${encodeURIComponent(extensionId)}/${encodeURIComponent(document.revisionId)}/`
      return {
        ...document,
        html: decorateHtml(document.html, assetBase, revision?.permissions ?? []),
        assetUrl: assetBase,
      }
    }
    const provider = String(document.metadata?.provider ?? revision?.manifest.mcp?.providers[0]?.alias ?? "")
    if (!provider) return null
    const resource = target === "candidate"
      ? await runtime.readPreparedResource(extensionId, document.revisionId, provider, document.resourceUri)
      : await runtime.readResource(extensionId, provider, document.resourceUri)
    const content = resource.contents.find((item) => item.mimeType === "text/html;profile=mcp-app" || item.mimeType === "text/html")
    if (!content?.text) return null
    const assetBase = `${assets.url()}/assets/${encodeURIComponent(extensionId)}/${encodeURIComponent(document.revisionId)}/`
    return {
      ...document,
      html: decorateHtml(content.text, assetBase, revision?.permissions ?? []),
      assetUrl: assetBase,
      metadata: { ...document.metadata, provider },
    }
  })
  handle("managed-extensions:call-tool", (input: { extensionId: string; providerAlias: string; name: string; arguments?: Record<string, unknown>; revisionId?: string }) =>
    input.revisionId
      ? runtime.callPreparedTool(input.extensionId, input.revisionId, input.providerAlias, input.name, input.arguments)
      : runtime.callTool(input.extensionId, input.providerAlias, input.name, input.arguments),
  )
  handle("managed-extensions:read-resource", async (input: { extensionId: string; providerAlias: string; uri: string; revisionId?: string }) => {
    if (!input.revisionId) {
      return runtime.readResource(input.extensionId, input.providerAlias, input.uri)
    }
    const summary = await service.get(input.extensionId)
    if (summary?.activeRevisionId === input.revisionId) {
      return runtime.readResource(input.extensionId, input.providerAlias, input.uri)
    }
    if (summary?.candidateRevision?.id === input.revisionId) {
      return runtime.readPreparedResource(
        input.extensionId,
        input.revisionId,
        input.providerAlias,
        input.uri,
      )
    }
    return readHistoricalResource({ ...input, revisionId: input.revisionId })
  })

  return {
    service,
    runtime,
    extensionBridgeUrl: extensionBridge.url(),
    extensionBridgeToken: extensionBridge.token(),
    async stop() {
      unsubscribe()
      await Promise.allSettled([
        service.close(),
        runtime.close(),
        assets.stop(),
        draftPreview?.stop(),
        extensionBridge.stop(),
      ])
    },
  }
}
