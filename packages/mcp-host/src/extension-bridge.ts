import { randomBytes } from "node:crypto"
import http from "node:http"

import { isToolVisibilityAppOnly } from "@modelcontextprotocol/ext-apps/app-bridge"

import type { ManagedExtensionService } from "@amiba/managed-extensions"
import type { ManagedMcpRuntime } from "./types"

export interface AmibaExtensionBridgeServer {
  url(): string
  token(): string
  stop(): Promise<void>
}

/** A privileged Amiba-hosted tool projected into Hermes by the bundled plugin. */
export interface AmibaHostTool {
  definition: {
    name: string
    description?: string
    inputSchema: Record<string, unknown>
    toolset?: string
    _meta?: Record<string, unknown>
  }
  call(argumentsValue: Record<string, unknown>): Promise<unknown> | unknown
}

export interface AmibaExtensionBridgeOptions {
  preferredPort?: number
  tools?: readonly AmibaHostTool[]
  previewDraft?: (input: {
    extensionId: string
    draftId: string
    surfaceName: "main" | "settings"
    runTests: boolean
  }) => Promise<unknown>
}

export interface AmibaPluginToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  toolset: string
}

export interface AmibaPluginToolCatalog {
  generation: number
  tools: AmibaPluginToolDefinition[]
}

interface ToolRoute {
  extensionId: string
  providerAlias: string
  toolName: string
}

const MANAGEMENT_TOOLS: readonly AmibaPluginToolDefinition[] = [
  {
    name: "amiba_create_extension",
    toolset: "extensions",
    description: "Create an Amiba Extension from an ordinary user conversation. Always use this instead of writing managed-extensions state yourself. Reuse operation_id when retrying the same user request, then follow agentPrompt in the returned isolated workspace.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short user-facing Extension name." },
        request: { type: "string", description: "Complete description of what the Extension should do." },
        description: { type: "string", description: "Optional one-line library description." },
        operation_id: { type: "string", description: "Stable unique key for this user message; reuse it for retries." },
      },
      required: ["name", "request", "operation_id"],
      additionalProperties: false,
    },
  },
  {
    name: "amiba_update_extension",
    toolset: "extensions",
    description: "Start an isolated Agent draft to improve an existing Amiba Extension. Follow agentPrompt and edit only the returned workspace.",
    inputSchema: {
      type: "object",
      properties: {
        extension_id: { type: "string" },
        request: { type: "string", description: "The requested change." },
      },
      required: ["extension_id", "request"],
      additionalProperties: false,
    },
  },
  {
    name: "amiba_get_extension_status",
    toolset: "extensions",
    description: "Get the current creation, update, candidate, or active status of an Amiba Extension.",
    inputSchema: {
      type: "object",
      properties: { extension_id: { type: "string" } },
      required: ["extension_id"],
      additionalProperties: false,
    },
  },
  {
    name: "amiba_list_extensions",
    toolset: "extensions",
    description: "List Amiba Extensions, including their stable IDs and current statuses.",
    inputSchema: {
      type: "object",
      properties: { include_archived: { type: "boolean", default: false } },
      additionalProperties: false,
    },
  },
  {
    name: "amiba_cancel_extension_operation",
    toolset: "extensions",
    description: "Cancel a pending Amiba Extension creation or update and clean its isolated draft. An initial Extension with no usable revision is removed completely.",
    inputSchema: {
      type: "object",
      properties: {
        extension_id: { type: "string" },
        draft_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["extension_id", "draft_id"],
      additionalProperties: false,
    },
  },
  {
    name: "amiba_preview_extension_draft",
    toolset: "extensions",
    description: "Build and validate the current isolated Extension draft, serve its selected UI surface on localhost, and open it in Amiba's visible built-in browser. After this succeeds, inspect the same page with amiba_browser_snapshot, amiba_browser_screenshot, and amiba_browser_console; exercise interactions with the browser click/type/press/scroll tools, fix the source, and call this tool again before submitting .amiba/result.json.",
    inputSchema: {
      type: "object",
      properties: {
        extension_id: { type: "string", description: "Stable Extension id returned by create/update." },
        draft_id: { type: "string", description: "Current isolated draft id returned by create/update." },
        surface: {
          type: "string",
          enum: ["main", "settings"],
          default: "main",
          description: "Extension UI surface to preview.",
        },
        run_tests: {
          type: "boolean",
          default: true,
          description: "Run manifest.build.testCommands before building the preview.",
        },
      },
      required: ["extension_id", "draft_id"],
      additionalProperties: false,
    },
  },
  {
    name: "amiba_list_extension_resources",
    toolset: "extensions",
    description: "List non-UI MCP resources exposed by active Amiba Extensions.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "amiba_read_extension_resource",
    toolset: "extensions",
    description: "Read a resource URI returned by amiba_list_extension_resources.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "An amiba-extension:// resource URI." },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
]

function argumentsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function managementResult(value: unknown, message: string) {
  return {
    content: [{ type: "text" as const, text: `${message}\n${JSON.stringify(value, null, 2)}` }],
    structuredContent: { result: value },
  }
}

function token(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_")
}

function toolRoutes(runtime: ManagedMcpRuntime): Map<string, ToolRoute> {
  const routes = new Map<string, ToolRoute>()
  for (const extension of runtime.listActive()) {
    for (const tool of extension.capabilities.tools) {
      if (isToolVisibilityAppOnly(tool as never)) continue
      const [providerAlias, ...parts] = tool.name.split("/")
      const toolName = parts.join("/")
      if (!providerAlias || !toolName) continue
      routes.set(`${token(extension.extensionId)}__${token(providerAlias)}__${token(toolName)}`, {
        extensionId: extension.extensionId,
        providerAlias,
        toolName,
      })
    }
  }
  return routes
}

function extensionToolDefinitions(runtime: ManagedMcpRuntime): AmibaPluginToolDefinition[] {
  const extensions = new Map(runtime.listActive().map((extension) => [extension.extensionId, extension]))
  return [...toolRoutes(runtime).entries()].map(([name, route]) => {
    const source = extensions
      .get(route.extensionId)
      ?.capabilities.tools.find(
        (tool) => tool.name === `${route.providerAlias}/${route.toolName}`,
      )
    return {
      name,
      toolset: "extensions",
      description: source?.description
        ? `${extensions.get(route.extensionId)?.manifest.name}: ${source.description}`
        : `${extensions.get(route.extensionId)?.manifest.name ?? route.extensionId} / ${route.toolName}`,
      inputSchema: source?.inputSchema ?? { type: "object", properties: {} },
    }
  })
}

function resourceCatalog(runtime: ManagedMcpRuntime) {
  return runtime.listActive().flatMap((extension) =>
    extension.capabilities.resources
      .filter((resource) => resource._meta?.["com.amiba/staticSurface"] !== true)
      .map((resource) => ({
        ...resource,
        uri: `amiba-extension://${encodeURIComponent(extension.extensionId)}/${encodeURIComponent(resource.uri)}`,
        name: resource.name ?? extension.manifest.name,
      })),
  )
}

function hostToolDefinitions(options: AmibaExtensionBridgeOptions): AmibaPluginToolDefinition[] {
  return (options.tools ?? []).map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    inputSchema: tool.definition.inputSchema,
    toolset: tool.definition.toolset ?? "extensions",
  }))
}

export function createAmibaExtensionBridge(
  runtime: ManagedMcpRuntime,
  management?: ManagedExtensionService,
  options: AmibaExtensionBridgeOptions = {},
) {
  return {
    catalog(generation = 1): AmibaPluginToolCatalog {
      return {
        generation,
        tools: [
          ...(management ? MANAGEMENT_TOOLS : []),
          ...hostToolDefinitions(options),
          ...extensionToolDefinitions(runtime),
        ],
      }
    },

    async call(name: string, value: unknown): Promise<unknown> {
      const input = argumentsObject(value)
      const hostTool = options.tools?.find((tool) => tool.definition.name === name)
      if (hostTool) return hostTool.call(input)

      if (management && name === "amiba_create_extension") {
        const result = await management.create({
          name: requiredString(input, "name"),
          request: requiredString(input, "request"),
          description: typeof input.description === "string" ? input.description : undefined,
          operationId: requiredString(input, "operation_id"),
        })
        return managementResult(result, "Extension draft created. Follow agentPrompt in workspacePath; never edit Amiba registry or version-state files directly.")
      }
      if (management && name === "amiba_update_extension") {
        const result = await management.requestChange(
          requiredString(input, "extension_id"),
          requiredString(input, "request"),
        )
        return managementResult(result, "Extension update draft created. Follow agentPrompt in workspacePath.")
      }
      if (management && name === "amiba_preview_extension_draft" && options.previewDraft) {
        const surface = input.surface ?? "main"
        if (surface !== "main" && surface !== "settings") {
          throw new Error("surface must be main or settings")
        }
        const result = await options.previewDraft({
          extensionId: requiredString(input, "extension_id"),
          draftId: requiredString(input, "draft_id"),
          surfaceName: surface,
          runTests: input.run_tests !== false,
        })
        return managementResult(result, "Extension draft validated and opened in Amiba's visible browser. Inspect its snapshot, screenshot, console, and interactions before submitting the result file.")
      }
      if (management && name === "amiba_get_extension_status") {
        const result = await management.get(requiredString(input, "extension_id"))
        if (!result) throw new Error("Extension not found")
        return managementResult(result, "Extension status loaded.")
      }
      if (management && name === "amiba_list_extensions") {
        const result = await management.list({ includeArchived: input.include_archived === true })
        return managementResult(result, "Extensions loaded.")
      }
      if (management && name === "amiba_cancel_extension_operation") {
        const result = await management.abortDraft(
          requiredString(input, "extension_id"),
          requiredString(input, "draft_id"),
          typeof input.reason === "string" ? input.reason : undefined,
        )
        return managementResult(result, "Extension operation cancelled and its draft cleaned.")
      }
      if (name === "amiba_list_extension_resources") {
        return managementResult(resourceCatalog(runtime), "Extension resources loaded.")
      }
      if (name === "amiba_read_extension_resource") {
        const uri = requiredString(input, "uri")
        const parsed = new URL(uri)
        if (parsed.protocol !== "amiba-extension:") throw new Error("unsupported resource URI")
        const extensionId = decodeURIComponent(parsed.hostname)
        const originalUri = decodeURIComponent(parsed.pathname.slice(1))
        const extension = runtime.listActive().find((entry) => entry.extensionId === extensionId)
        if (!extension) throw new Error("Extension is not active")
        const resource = extension.capabilities.resources.find((item) => item.uri === originalUri)
        if (resource?._meta?.["com.amiba/staticSurface"] === true) {
          throw new Error("Extension UI resources are rendered by the host and are not agent context")
        }
        const provider = resource?._meta?.["com.amiba/providerAlias"]
        if (!provider) throw new Error("Extension resource has no MCP provider")
        return runtime.readResource(extensionId, String(provider), originalUri)
      }

      const route = toolRoutes(runtime).get(name)
      if (!route) throw new Error("This Extension tool is no longer available.")
      return runtime.callTool(route.extensionId, route.providerAlias, route.toolName, input)
    },
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 10 * 1024 * 1024) throw new Error("request body is too large")
    chunks.push(bytes)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function json(response: http.ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  })
  response.end(body)
}

export async function startAmibaExtensionBridgeServer(
  runtime: ManagedMcpRuntime,
  management?: ManagedExtensionService,
  options: AmibaExtensionBridgeOptions = {},
): Promise<AmibaExtensionBridgeServer> {
  const accessToken = randomBytes(32).toString("hex")
  const bridge = createAmibaExtensionBridge(runtime, management, options)
  let generation = 1
  const waiters = new Set<() => void>()
  const notifyCatalogChanged = () => {
    generation += 1
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
  const unsubscribe = runtime.onCapabilitiesChanged(notifyCatalogChanged)

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost")
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      json(response, 401, { ok: false, error: "Unauthorized" })
      return
    }
    try {
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        json(response, 200, { ok: true })
        return
      }
      if (request.method === "GET" && requestUrl.pathname === "/catalog") {
        const after = Number(requestUrl.searchParams.get("after")) || 0
        const waitMs = Math.max(
          0,
          Math.min(30_000, Number(requestUrl.searchParams.get("wait_ms")) || 0),
        )
        if (after >= generation && waitMs > 0) {
          await new Promise<void>((resolve) => {
            let timer: NodeJS.Timeout
            const finish = () => {
              clearTimeout(timer)
              waiters.delete(finish)
              response.off("close", finish)
              resolve()
            }
            timer = setTimeout(finish, waitMs)
            waiters.add(finish)
            response.once("close", finish)
          })
        }
        if (response.destroyed) return
        json(response, 200, bridge.catalog(generation))
        return
      }
      if (request.method === "POST" && requestUrl.pathname === "/call") {
        const body = argumentsObject(await readJsonBody(request))
        const name = requiredString(body, "name")
        const result = await bridge.call(name, body.arguments)
        json(response, 200, { ok: true, result })
        return
      }
      json(response, 404, { ok: false, error: "Not Found" })
    } catch (error) {
      json(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(options.preferredPort ?? 0, "127.0.0.1", () => {
      server.off("error", onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("plugin bridge has no TCP address")
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    url: () => baseUrl,
    token: () => accessToken,
    stop: async () => {
      unsubscribe()
      for (const resolve of waiters) resolve()
      waiters.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
