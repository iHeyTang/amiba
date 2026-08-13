import http from "node:http"
import { extname } from "node:path"
import { appendFile, cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"

import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import { createManagedAppService, type ManagedAppService } from "@amiba/managed-apps"
import {
  createManagedMcpRuntime,
} from "@amiba/mcp-host/runtime"
import type { ManagedMcpRuntime } from "@amiba/mcp-host/types"
import type { McpToolResult } from "@amiba/mcp-host/types"
import {
  startMcpFederationServer,
  type McpFederationServer,
} from "@amiba/mcp-host/federation"

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

export interface ManagedAppsController {
  service: ManagedAppService
  runtime: ManagedMcpRuntime
  federationUrl: string
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

async function startAssetsServer(service: ManagedAppService): Promise<{
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
      const [, appId, revisionId, ...assetParts] = parts
      const path = await service.resolveAsset(appId, revisionId, assetParts.join("/"))
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

function sendChanged(appId: string | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("managed-apps:changed", appId)
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

function stableDataPath(root: string, appId: string): string {
  return join(root, appId, "data")
}

function candidateDataPath(root: string, appId: string, revisionId: string): string {
  return join(root, appId, "candidate-data", revisionId)
}

function backupDataPath(root: string, appId: string, revisionId: string): string {
  return join(root, appId, "data-backups", revisionId)
}

async function seedCandidateData(root: string, appId: string, revisionId: string): Promise<void> {
  const source = stableDataPath(root, appId)
  const destination = candidateDataPath(root, appId, revisionId)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(root, appId, "candidate-data"), { recursive: true })
  if (await pathExists(source)) await cp(source, destination, { recursive: true })
  else await mkdir(destination, { recursive: true })
}

async function seedHistoricalData(root: string, appId: string, revisionId: string): Promise<void> {
  const source = backupDataPath(root, appId, revisionId)
  if (!(await pathExists(source))) {
    throw new Error("The data snapshot for this Applet revision is no longer available")
  }
  const destination = candidateDataPath(root, appId, revisionId)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(root, appId, "candidate-data"), { recursive: true })
  await cp(source, destination, { recursive: true })
}

async function snapshotData(
  root: string,
  appId: string,
  revisionId: string | undefined,
): Promise<void> {
  if (!revisionId) return
  const source = stableDataPath(root, appId)
  const destination = backupDataPath(root, appId, revisionId)
  const temporary = `${destination}.${Date.now()}.tmp`
  await mkdir(join(root, appId, "data-backups"), { recursive: true })
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
  const { appId, revision, previous } = input
  const stable = stableDataPath(root, appId)
  const candidate = candidateDataPath(root, appId, revision.id)
  const backup = backupDataPath(root, appId, revision.id)
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

  await snapshotData(root, appId, previous?.id)
  const staged = incoming === candidate
    ? candidate
    : join(root, appId, "candidate-data", `${revision.id}-restore-${Date.now()}`)
  if (incoming !== candidate) {
    await mkdir(join(root, appId, "candidate-data"), { recursive: true })
    await cp(incoming, staged, { recursive: true })
  }
  const displaced = join(root, appId, `data-displaced-${Date.now()}`)
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

export async function startManagedAppsController(options: {
  root: string
  pythonCommand?: string
  resolveRegisteredProvider?: NonNullable<Parameters<typeof createManagedMcpRuntime>[0]>["resolveRegisteredProvider"]
}): Promise<ManagedAppsController> {
  let serviceRef: ManagedAppService | null = null
  const runtime = createManagedMcpRuntime({
    resolveRegisteredProvider: options.resolveRegisteredProvider,
    resolveDataPath: (appId, revisionId, mode) => mode === "active"
      ? stableDataPath(options.root, appId)
      : candidateDataPath(options.root, appId, revisionId),
    onToolCall: (event) => {
      const auditRoot = join(options.root, ".audit")
      const path = join(auditRoot, `${new Date().toISOString().slice(0, 10)}.jsonl`)
      void mkdir(auditRoot, { recursive: true })
        .then(() => appendFile(path, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`, "utf8"))
        .catch((error) => console.warn("[managed-apps] audit write failed:", error))
    },
    onToolResult: (event) => {
      const outputs = outputsFromToolResult(event)
      if (outputs.length) void serviceRef?.recordOutputs(event.appId, outputs)
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
  const service = createManagedAppService({
    root: options.root,
    hooks: {
      discover: (input) => runtime.discover(input),
      validateCandidate: async (input) => {
        await seedCandidateData(options.root, input.appId, input.revision.id)
        await runtime.prepare(input)
      },
      activate: (input) => activateWithData(options.root, runtime, input),
      deactivate: (appId) => runtime.deactivate(appId),
      discardCandidate: async (appId, revisionId) => {
        await runtime.discardPrepared(appId, revisionId)
        await rm(candidateDataPath(options.root, appId, revisionId), {
          recursive: true,
          force: true,
        })
      },
    },
  })
  serviceRef = service
  await service.init()
  const assets = await startAssetsServer(service)
  const federation = await startMcpFederationServer(runtime)
  const unsubscribe = service.onChanged(sendChanged)
  const historicalOperations = new Map<string, Promise<unknown>>()

  async function readHistoricalResource(input: {
    appId: string
    revisionId: string
    providerAlias: string
    uri: string
  }) {
    const operationKey = `${input.appId}:${input.revisionId}`
    const previous = historicalOperations.get(operationKey) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const deployment = await service.revisionDeployment(input.appId, input.revisionId)
      if (!deployment) throw new Error("The referenced Applet revision is unavailable")
      await seedHistoricalData(options.root, input.appId, input.revisionId)
      await runtime.prepare({
        appId: input.appId,
        revision: deployment.revision,
        bundlePath: deployment.bundlePath,
      })
      try {
        return await runtime.readPreparedResource(
          input.appId,
          input.revisionId,
          input.providerAlias,
          input.uri,
        )
      } finally {
        await runtime.discardPrepared(input.appId, input.revisionId)
        await rm(candidateDataPath(options.root, input.appId, input.revisionId), {
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

  handle("managed-apps:list", (listOptions?: { includeArchived?: boolean }) => service.list(listOptions))
  handle("managed-apps:get", (appId: string) => service.get(appId))
  handle("managed-apps:create", (request: Parameters<ManagedAppService["create"]>[0]) => service.create(request))
  handle("managed-apps:request-change", (appId: string, request: string) => service.requestChange(appId, request))
  handle("managed-apps:attach-session", (appId: string, draftId: string, sessionId: string) =>
    service.attachSession(appId, draftId, sessionId),
  )
  handle("managed-apps:update-metadata", (appId: string, patch: Parameters<ManagedAppService["updateMetadata"]>[1]) =>
    service.updateMetadata(appId, patch),
  )
  handle("managed-apps:archive", (appId: string) => service.archive(appId))
  handle("managed-apps:restore", (appId: string) => service.restore(appId))
  handle("managed-apps:export", async (appId: string) => {
    const options = {
      title: "导出小应用项目",
      buttonLabel: "导出到这里",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    }
    const owner = BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const destination = await service.exportProject(appId, result.filePaths[0])
    shell.showItemInFolder(destination)
    return destination
  })
  handle("managed-apps:list-outputs", (appId: string) => service.listOutputs(appId))
  handle("managed-apps:update-output", (
    appId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ) => service.updateOutput(appId, outputId, patch))
  handle("managed-apps:list-presets", (appId: string) => service.listPresets(appId))
  handle("managed-apps:save-preset", (
    appId: string,
    input: Parameters<ManagedAppService["savePreset"]>[1],
  ) => service.savePreset(appId, input))
  handle("managed-apps:delete-preset", (appId: string, presetId: string) =>
    service.deletePreset(appId, presetId),
  )
  handle("managed-apps:confirm", (appId: string, revisionId: string) => service.confirm(appId, revisionId))
  handle("managed-apps:reject", (appId: string, revisionId: string) => service.reject(appId, revisionId))
  handle("managed-apps:rollback", (appId: string) => service.rollback(appId))
  handle("managed-apps:mark-used", (appId: string) => service.markUsed(appId))
  handle("managed-apps:surface", async (
    appId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ) => {
    const document = await service.surface(appId, target, surfaceName)
    if (!document) return null
    const summary = await service.get(appId)
    const revision = target === "candidate" ? summary?.candidateRevision : summary?.activeRevision
    if (document.html) {
      const assetBase = `${assets.url()}/assets/${encodeURIComponent(appId)}/${encodeURIComponent(document.revisionId)}/`
      return {
        ...document,
        html: decorateHtml(document.html, assetBase, revision?.permissions ?? []),
        assetUrl: assetBase,
      }
    }
    const provider = String(document.metadata?.provider ?? revision?.manifest.mcp?.providers[0]?.alias ?? "")
    if (!provider) return null
    const resource = target === "candidate"
      ? await runtime.readPreparedResource(appId, document.revisionId, provider, document.resourceUri)
      : await runtime.readResource(appId, provider, document.resourceUri)
    const content = resource.contents.find((item) => item.mimeType === "text/html;profile=mcp-app" || item.mimeType === "text/html")
    if (!content?.text) return null
    const assetBase = `${assets.url()}/assets/${encodeURIComponent(appId)}/${encodeURIComponent(document.revisionId)}/`
    return {
      ...document,
      html: decorateHtml(content.text, assetBase, revision?.permissions ?? []),
      assetUrl: assetBase,
      metadata: { ...document.metadata, provider },
    }
  })
  handle("managed-apps:call-tool", (input: { appId: string; providerAlias: string; name: string; arguments?: Record<string, unknown>; revisionId?: string }) =>
    input.revisionId
      ? runtime.callPreparedTool(input.appId, input.revisionId, input.providerAlias, input.name, input.arguments)
      : runtime.callTool(input.appId, input.providerAlias, input.name, input.arguments),
  )
  handle("managed-apps:read-resource", async (input: { appId: string; providerAlias: string; uri: string; revisionId?: string }) => {
    if (!input.revisionId) {
      return runtime.readResource(input.appId, input.providerAlias, input.uri)
    }
    const summary = await service.get(input.appId)
    if (summary?.activeRevisionId === input.revisionId) {
      return runtime.readResource(input.appId, input.providerAlias, input.uri)
    }
    if (summary?.candidateRevision?.id === input.revisionId) {
      return runtime.readPreparedResource(
        input.appId,
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
    federationUrl: federation.url(),
    async stop() {
      unsubscribe()
      await Promise.allSettled([service.close(), runtime.close(), assets.stop(), federation.stop()])
    },
  }
}
