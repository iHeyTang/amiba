import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, resolve, sep } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import type {
  ManagedExtensionCapabilitySnapshot,
  ManagedExtensionManifest,
  ManagedExtensionProviderManifest,
  ManagedExtensionRevision,
} from "@amiba/managed-extensions/types"
import type {
  ManagedMcpRuntime,
  McpResourceResult,
  McpToolResult,
  PreparedManagedExtension,
} from "./types"

interface ProviderConnection {
  alias: string
  client: Client
  transport: Transport
}

interface RuntimeEntry extends PreparedManagedExtension {
  providers: Map<string, ProviderConnection>
}

function assertToolPermissions(entry: RuntimeEntry, providerAlias: string, name: string): void {
  const tool = entry.capabilities.tools.find((item) => item.name === `${providerAlias}/${name}`)
  const required = tool?._meta?.["com.amiba/permissions"]
  if (!Array.isArray(required)) return
  const granted = new Set(entry.revision.permissions)
  const missing = required.filter(
    (permission): permission is string => typeof permission === "string" && !granted.has(permission),
  )
  if (missing.length) throw new Error(`Tool permissions were not granted: ${missing.join(", ")}`)
}

export interface ManagedMcpRuntimeOptions {
  resolveCommand?: (
    runtime: "node" | "python",
    bundlePath: string,
  ) => { command: string; argsPrefix?: string[]; env?: Record<string, string> }
  resolveRegisteredProvider?: (
    providerId: string,
  ) => Promise<{
    url?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    headers?: Record<string, string>
  } | null>
  resolveDataPath?: (
    extensionId: string,
    revisionId: string,
    mode: "candidate" | "active",
  ) => string
  onToolCall?: (event: {
    extensionId: string
    revisionId: string
    providerAlias: string
    toolName: string
    success: boolean
    durationMs: number
    error?: string
  }) => void
  onToolResult?: (event: {
    extensionId: string
    revisionId: string
    providerAlias: string
    toolName: string
    result: McpToolResult
  }) => void
}

const EMPTY_CAPABILITIES: ManagedExtensionCapabilitySnapshot = {
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
}
const MAX_DISCOVERY_ITEMS = 10_000
const MAX_MCP_RESULT_BYTES = 16 * 1024 * 1024
const TOOL_TIMEOUT_MS = 2 * 60_000

function assertBoundedResult<T>(value: T, label: string): T {
  const size = Buffer.byteLength(JSON.stringify(value), "utf8")
  if (size > MAX_MCP_RESULT_BYTES) {
    throw new Error(`${label} exceeded the ${MAX_MCP_RESULT_BYTES} byte limit`)
  }
  return value
}

function safeProcessEnvironment(): Record<string, string> {
  return Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SystemRoot"]
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

async function allPages<T extends { nextCursor?: string }>(
  load: (cursor?: string) => Promise<T>,
  values: (page: T) => unknown[],
): Promise<unknown[]> {
  const result: unknown[] = []
  let cursor: string | undefined
  const cursors = new Set<string>()
  do {
    const page = await load(cursor)
    result.push(...values(page))
    if (result.length > MAX_DISCOVERY_ITEMS) {
      throw new Error(`MCP discovery exceeded ${MAX_DISCOVERY_ITEMS} items`)
    }
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error("MCP discovery returned a repeated cursor")
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return result
}

function providerCommand(
  provider: ManagedExtensionProviderManifest & { env?: Record<string, string>; cwd?: string },
  root: string,
  options: ManagedMcpRuntimeOptions,
): { command: string; args: string[]; env?: Record<string, string>; cwd?: string } {
  if (provider.command) {
    return {
      command: provider.command,
      args: provider.args ?? [],
      cwd: provider.cwd,
      env: { ...safeProcessEnvironment(), ...(provider.env ?? {}) },
    }
  }
  if (!provider.entry || !provider.runtime) {
    throw new Error(`provider ${provider.alias} has no executable entry`)
  }
  const entry = resolve(root, provider.entry)
  const normalizedRoot = resolve(root)
  if (entry !== normalizedRoot && !entry.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`provider entry escapes the Extension bundle: ${provider.entry}`)
  }
  if (!existsSync(entry)) throw new Error(`provider entry does not exist: ${provider.entry}`)
  const configured = options.resolveCommand?.(provider.runtime, root)
  if (configured) {
    return {
      command: configured.command,
      args: [...(configured.argsPrefix ?? []), entry, ...(provider.args ?? [])],
      env: configured.env,
    }
  }
  const safeEnv = safeProcessEnvironment()
  if (provider.runtime === "node" && process.versions.electron) {
    safeEnv.ELECTRON_RUN_AS_NODE = "1"
  }
  return {
    command: provider.runtime === "node" ? process.execPath : "python3",
    args: [entry, ...(provider.args ?? [])],
    env: safeEnv,
  }
}

function macRuntimeSandbox(
  command: { command: string; args: string[]; env?: Record<string, string>; cwd?: string },
  bundlePath: string,
  dataPath: string,
  permissions: string[],
): { command: string; args: string[]; env?: Record<string, string>; cwd?: string } {
  if (process.platform !== "darwin") return command
  const quote = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
  const readable = [
    bundlePath,
    dataPath,
    tmpdir(),
    command.cwd,
    ...(isAbsolute(command.command) ? [dirname(command.command)] : []),
    ...(command.env?.PATH ?? process.env.PATH ?? "").split(delimiter),
  ].filter((path): path is string => !!path)
  const profile = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath "${quote(homedir())}"))`,
    `(allow file-read* ${readable.map((path) => `(subpath "${quote(resolve(path))}")`).join(" ")})`,
    "(deny file-write*)",
    `(allow file-write* (subpath "${quote(resolve(dataPath))}") (subpath "${quote(resolve(tmpdir()))}"))`,
    permissions.some((permission) => permission.startsWith("network:")) ? "" : "(deny network*)",
    permissions.includes("subprocess") ? "" : "(deny process-fork)",
  ].filter(Boolean).join(" ")
  return {
    command: "sandbox-exec",
    args: ["-p", profile, command.command, ...command.args],
    env: command.env,
    cwd: command.cwd,
  }
}

function assertProviderUrl(url: string, permissions: string[]): void {
  const parsed = new URL(url)
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1"
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("remote MCP providers must use HTTPS; loopback HTTP is allowed")
  }
  if (loopback) return
  const permission = `network:${parsed.origin}`
  if (!permissions.includes(permission)) {
    throw new Error(`remote MCP provider requires declared permission: ${permission}`)
  }
}

async function connectProvider(
  extensionId: string,
  revisionId: string,
  dataMode: "candidate" | "active",
  provider: ManagedExtensionProviderManifest,
  root: string,
  options: ManagedMcpRuntimeOptions,
  permissions: string[],
): Promise<ProviderConnection> {
  let resolvedProvider: ManagedExtensionProviderManifest & {
    env?: Record<string, string>
    cwd?: string
    headers?: Record<string, string>
  } = provider
  if (provider.kind === "registered" && provider.providerId && !provider.url) {
    const registered = await options.resolveRegisteredProvider?.(provider.providerId)
    if (!registered) {
      throw new Error(`registered MCP provider is unavailable: ${provider.providerId}`)
    }
    resolvedProvider = { ...registered, alias: provider.alias, kind: "registered" }
  }
  let transport: Transport
  if (resolvedProvider.url) {
    assertProviderUrl(resolvedProvider.url, permissions)
    transport = new StreamableHTTPClientTransport(new URL(resolvedProvider.url), {
      requestInit: resolvedProvider.headers
        ? { headers: resolvedProvider.headers }
        : undefined,
    })
  } else {
    const dataPath = resolve(
      options.resolveDataPath?.(extensionId, revisionId, dataMode) ??
        resolve(tmpdir(), "amiba-mcp-host", extensionId, dataMode, revisionId),
    )
    await mkdir(dataPath, { recursive: true })
    const command = macRuntimeSandbox(
      providerCommand(resolvedProvider, root, options),
      root,
      dataPath,
      permissions,
    )
    transport = new StdioClientTransport({
      command: command.command,
      args: command.args,
      cwd: command.cwd ?? root,
      env: { ...(command.env ?? {}), AMIBA_APP_DATA_DIR: dataPath },
      stderr: "inherit",
    })
  }
  const client = new Client(
    { name: "Amiba", version: "0.1.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      } as never,
    },
  )
  await client.connect(transport)
  await client.ping()
  return { alias: provider.alias, client, transport }
}

async function discoverConnections(
  manifest: ManagedExtensionManifest,
  connections: Map<string, ProviderConnection>,
): Promise<ManagedExtensionCapabilitySnapshot> {
  const snapshot: ManagedExtensionCapabilitySnapshot = {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
  }
  for (const [alias, connection] of connections) {
    const capabilities = connection.client.getServerCapabilities()
    if (capabilities?.tools) {
      const tools = await allPages(
        (cursor) => connection.client.listTools(cursor ? { cursor } : undefined),
        (page) => page.tools,
      )
      snapshot.tools.push(
        ...tools.map((raw) => {
          const tool = raw as Record<string, unknown>
          return {
            ...tool,
            name: `${alias}/${String(tool.name ?? "")}`,
            _meta: {
              ...((tool._meta as Record<string, unknown> | undefined) ?? {}),
              "com.amiba/providerAlias": alias,
            },
          } as never
        }),
      )
    }
    if (capabilities?.resources) {
      const resources = await allPages(
        (cursor) => connection.client.listResources(cursor ? { cursor } : undefined),
        (page) => page.resources,
      )
      snapshot.resources.push(
        ...resources.map((raw) => {
          const resource = raw as Record<string, unknown>
          return {
            ...resource,
            _meta: {
              ...((resource._meta as Record<string, unknown> | undefined) ?? {}),
              "com.amiba/providerAlias": alias,
            },
          } as never
        }),
      )
      const templates = await allPages(
        (cursor) => connection.client.listResourceTemplates(cursor ? { cursor } : undefined),
        (page) => page.resourceTemplates,
      )
      snapshot.resourceTemplates.push(
        ...templates.map((raw) => {
          const template = raw as Record<string, unknown>
          return {
            ...template,
            _meta: {
              ...((template._meta as Record<string, unknown> | undefined) ?? {}),
              "com.amiba/providerAlias": alias,
            },
          } as never
        }),
      )
    }
    if (capabilities?.prompts) {
      const prompts = await allPages(
        (cursor) => connection.client.listPrompts(cursor ? { cursor } : undefined),
        (page) => page.prompts,
      )
      snapshot.prompts.push(...(prompts as never[]))
    }
  }
  if (manifest.runtime === "static-mcp-app") {
    snapshot.resources.push(
      ...Object.values(manifest.surfaces ?? {}).flatMap((surface) =>
        surface
          ? [{
              uri: surface.resourceUri,
              name: manifest.name,
              mimeType: "text/html;profile=mcp-app",
              _meta: { "com.amiba/staticSurface": true },
            }]
          : [],
      ),
    )
  }
  return snapshot
}

async function validateDynamicSurfaces(
  manifest: ManagedExtensionManifest,
  connections: Map<string, ProviderConnection>,
): Promise<void> {
  for (const [name, surface] of Object.entries(manifest.surfaces ?? {})) {
    if (!surface || surface.entry) continue
    const alias = surface.provider ?? manifest.mcp?.providers[0]?.alias
    const provider = alias ? connections.get(alias) : undefined
    if (!provider) throw new Error(`surface ${name} has no active MCP provider`)
    const resource = assertBoundedResult(
      await provider.client.readResource(
        { uri: surface.resourceUri },
        { timeout: 60_000, maxTotalTimeout: 60_000 },
      ),
      `surface ${name}`,
    )
    const html = resource.contents.find(
      (item) =>
        item.uri === surface.resourceUri &&
        item.mimeType === "text/html;profile=mcp-app" &&
        "text" in item &&
        typeof item.text === "string",
    )
    if (!html) {
      throw new Error(
        `surface ${name} must resolve to ${surface.resourceUri} as text/html;profile=mcp-app`,
      )
    }
  }
}

async function closeEntry(entry?: RuntimeEntry): Promise<void> {
  if (!entry) return
  await Promise.allSettled(
    [...entry.providers.values()].map(async ({ client, transport }) => {
      try {
        await client.close()
      } finally {
        await transport.close().catch(() => {})
      }
    }),
  )
}

export function createManagedMcpRuntime(
  options: ManagedMcpRuntimeOptions = {},
): ManagedMcpRuntime {
  const active = new Map<string, RuntimeEntry>()
  const prepared = new Map<string, RuntimeEntry>()
  const listeners = new Set<() => void>()

  const key = (extensionId: string, revisionId: string) => `${extensionId}:${revisionId}`

  function preparedOrMatchingActive(extensionId: string, revisionId: string): RuntimeEntry | undefined {
    const candidate = prepared.get(key(extensionId, revisionId))
    if (candidate) return candidate
    const current = active.get(extensionId)
    return current?.revision.id === revisionId ? current : undefined
  }

  function emit(): void {
    for (const listener of listeners) listener()
  }

  async function prepareEntry(opts: {
    extensionId: string
    revision: ManagedExtensionRevision
    bundlePath: string
  }, mode: "candidate" | "active"): Promise<RuntimeEntry> {
    const cacheKey = key(opts.extensionId, opts.revision.id)
    const cached = mode === "candidate" ? prepared.get(cacheKey) : undefined
    if (cached) return cached
    const providers = new Map<string, ProviderConnection>()
    try {
      for (const provider of opts.revision.manifest.mcp?.providers ?? []) {
        providers.set(
          provider.alias,
          await connectProvider(
            opts.extensionId,
            opts.revision.id,
            mode,
            provider,
            opts.bundlePath,
            options,
            opts.revision.permissions,
          ),
        )
      }
      const capabilities = await discoverConnections(opts.revision.manifest, providers)
      await validateDynamicSurfaces(opts.revision.manifest, providers)
      const entry: RuntimeEntry = {
        extensionId: opts.extensionId,
        revision: opts.revision,
        manifest: opts.revision.manifest,
        bundlePath: opts.bundlePath,
        capabilities,
        providers,
      }
      if (mode === "candidate") prepared.set(cacheKey, entry)
      return entry
    } catch (error) {
      await closeEntry({
        extensionId: opts.extensionId,
        revision: opts.revision,
        manifest: opts.revision.manifest,
        bundlePath: opts.bundlePath,
        capabilities: EMPTY_CAPABILITIES,
        providers,
      })
      throw error
    }
  }

  return {
    async discover({ extensionId, projectPath, manifest }) {
      const providers = new Map<string, ProviderConnection>()
      const fakeRevision: ManagedExtensionRevision = {
        id: "discovery",
        extensionId: extensionId,
        sourceCommit: "",
        bundleHash: "",
        manifest,
        capabilities: EMPTY_CAPABILITIES,
        permissions: manifest.permissions ?? [],
        dataSchemaVersion: manifest.dataSchemaVersion ?? 1,
        userRequest: "",
        changeSummary: "",
        risk: "safe",
        status: "candidate",
        createdAt: new Date().toISOString(),
      }
      try {
        for (const provider of manifest.mcp?.providers ?? []) {
          providers.set(
            provider.alias,
            await connectProvider(
              extensionId,
              "discovery",
              "candidate",
              provider,
              projectPath,
              options,
              manifest.permissions ?? [],
            ),
          )
        }
        return await discoverConnections(manifest, providers)
      } finally {
        await closeEntry({
          extensionId,
          revision: fakeRevision,
          manifest,
          bundlePath: projectPath,
          capabilities: EMPTY_CAPABILITIES,
          providers,
        })
      }
    },

    async prepare(opts) {
      const entry = await prepareEntry(opts, "candidate")
      return entry
    },

    async activate(opts) {
      const candidateKey = key(opts.extensionId, opts.revision.id)
      const candidate = prepared.get(candidateKey)
      prepared.delete(candidateKey)
      await closeEntry(candidate)
      const next = await prepareEntry(opts, "active")
      const previous = active.get(opts.extensionId)
      active.set(opts.extensionId, next)
      if (previous && previous !== next) await closeEntry(previous)
      emit()
    },

    async deactivate(extensionId) {
      const entry = active.get(extensionId)
      active.delete(extensionId)
      await closeEntry(entry)
      emit()
    },

    async discardPrepared(extensionId, revisionId) {
      const cacheKey = key(extensionId, revisionId)
      const entry = prepared.get(cacheKey)
      prepared.delete(cacheKey)
      await closeEntry(entry)
    },

    listActive() {
      return [...active.values()]
    },

    async callTool(extensionId, providerAlias, name, args = {}) {
      const entry = active.get(extensionId)
      if (!entry) throw new Error(`MCP Extension is not active: ${extensionId}`)
      const provider = entry.providers.get(providerAlias)
      if (!provider) throw new Error(`MCP provider is not active: ${extensionId}/${providerAlias}`)
      assertToolPermissions(entry, providerAlias, name)
      const startedAt = Date.now()
      try {
        const result = assertBoundedResult(
          (await provider.client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: TOOL_TIMEOUT_MS, maxTotalTimeout: TOOL_TIMEOUT_MS },
          )) as McpToolResult,
          "MCP Tool result",
        )
        options.onToolResult?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, result })
        options.onToolCall?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, success: !result.isError, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        options.onToolCall?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, success: false, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },

    async callPreparedTool(extensionId, revisionId, providerAlias, name, args = {}) {
      const entry = preparedOrMatchingActive(extensionId, revisionId)
      if (!entry) throw new Error(`MCP Extension is not prepared: ${extensionId}`)
      const provider = entry.providers.get(providerAlias)
      if (!provider) {
        throw new Error(`MCP provider is not prepared: ${extensionId}/${providerAlias}`)
      }
      assertToolPermissions(entry, providerAlias, name)
      const startedAt = Date.now()
      try {
        const result = assertBoundedResult(
          (await provider.client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: TOOL_TIMEOUT_MS, maxTotalTimeout: TOOL_TIMEOUT_MS },
          )) as McpToolResult,
          "MCP Tool result",
        )
        options.onToolResult?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, result })
        options.onToolCall?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, success: !result.isError, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        options.onToolCall?.({ extensionId, revisionId: entry.revision.id, providerAlias, toolName: name, success: false, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },

    async readResource(extensionId, providerAlias, uri) {
      const entry = active.get(extensionId)
      const provider = entry?.providers.get(providerAlias)
      if (!provider) throw new Error(`MCP provider is not active: ${extensionId}/${providerAlias}`)
      return assertBoundedResult(
        (await provider.client.readResource({ uri }, { timeout: 60_000, maxTotalTimeout: 60_000 })) as McpResourceResult,
        "MCP Resource",
      )
    },

    async readPreparedResource(extensionId, revisionId, providerAlias, uri) {
      const entry = preparedOrMatchingActive(extensionId, revisionId)
      const provider = entry?.providers.get(providerAlias)
      if (!provider) {
        throw new Error(`MCP provider is not prepared: ${extensionId}/${providerAlias}`)
      }
      return assertBoundedResult(
        (await provider.client.readResource({ uri }, { timeout: 60_000, maxTotalTimeout: 60_000 })) as McpResourceResult,
        "MCP Resource",
      )
    },

    async close() {
      await Promise.allSettled([
        ...[...active.values()].map(closeEntry),
        ...[...prepared.values()].map(closeEntry),
      ])
      active.clear()
      prepared.clear()
    },

    onCapabilitiesChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
