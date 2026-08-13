import http from "node:http"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { isToolVisibilityAppOnly } from "@modelcontextprotocol/ext-apps/app-bridge"

import type { ManagedMcpRuntime } from "./types"

export interface McpFederationServer {
  url(): string
  stop(): Promise<void>
}

interface ToolRoute {
  appId: string
  providerAlias: string
  toolName: string
}

function token(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_")
}

function toolRoutes(runtime: ManagedMcpRuntime): Map<string, ToolRoute> {
  const routes = new Map<string, ToolRoute>()
  for (const app of runtime.listActive()) {
    for (const tool of app.capabilities.tools) {
      if (isToolVisibilityAppOnly(tool as never)) continue
      const [providerAlias, ...parts] = tool.name.split("/")
      const toolName = parts.join("/")
      if (!providerAlias || !toolName) continue
      routes.set(`${token(app.appId)}__${token(providerAlias)}__${token(toolName)}`, {
        appId: app.appId,
        providerAlias,
        toolName,
      })
    }
  }
  return routes
}

function createServer(runtime: ManagedMcpRuntime): Server {
  const server = new Server(
    { name: "Amiba Applets", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const routes = toolRoutes(runtime)
    const apps = new Map(runtime.listActive().map((app) => [app.appId, app]))
    return {
      tools: [...routes.entries()].map(([name, route]) => {
        const source = apps
          .get(route.appId)
          ?.capabilities.tools.find(
            (tool) => tool.name === `${route.providerAlias}/${route.toolName}`,
          )
        return {
          name,
          description: source?.description
            ? `${apps.get(route.appId)?.manifest.name}: ${source.description}`
            : `${apps.get(route.appId)?.manifest.name ?? route.appId} / ${route.toolName}`,
          inputSchema: source?.inputSchema ?? { type: "object", properties: {} },
          _meta: {
            ...(source?._meta ?? {}),
            "com.amiba/applet": {
              id: route.appId,
              provider: route.providerAlias,
              tool: route.toolName,
            },
          },
        }
      }),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const route = toolRoutes(runtime).get(params.name)
    if (!route) {
      return { content: [{ type: "text", text: "This Applet tool is no longer available." }], isError: true }
    }
    return runtime.callTool(
      route.appId,
      route.providerAlias,
      route.toolName,
      params.arguments,
    ) as never
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: runtime.listActive().flatMap((app) =>
      app.capabilities.resources
      .filter((resource) => resource._meta?.["com.amiba/staticSurface"] !== true)
      .map((resource) => ({
        ...resource,
        uri: `amiba-applet://${encodeURIComponent(app.appId)}/${encodeURIComponent(resource.uri)}`,
        name: resource.name ?? app.manifest.name,
      })),
    ),
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const parsed = new URL(params.uri)
    if (parsed.protocol !== "amiba-applet:") throw new Error("unsupported resource URI")
    const appId = decodeURIComponent(parsed.hostname)
    const originalUri = decodeURIComponent(parsed.pathname.slice(1))
    const app = runtime.listActive().find((entry) => entry.appId === appId)
    if (!app) throw new Error("Applet is not active")
    const resource = app.capabilities.resources.find((item) => item.uri === originalUri)
    if (resource?._meta?.["com.amiba/staticSurface"] === true) {
      throw new Error("Applet UI resources are rendered by the host and are not agent context")
    }
    const provider = resource?._meta?.["com.amiba/providerAlias"]
    if (!provider) throw new Error("Applet resource has no MCP provider")
    return runtime.readResource(appId, String(provider), originalUri) as never
  })

  return server
}

export async function startMcpFederationServer(
  runtime: ManagedMcpRuntime,
): Promise<McpFederationServer> {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname
    if (pathname !== "/mcp") {
      response.writeHead(404).end("Not Found")
      return
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const protocol = createServer(runtime)
    response.once("close", () => {
      void protocol.close().catch(() => {})
    })
    try {
      await protocol.connect(transport)
      await transport.handleRequest(request, response)
    } catch (error) {
      if (!response.headersSent) response.writeHead(500)
      response.end(error instanceof Error ? error.message : String(error))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve)
    server.once("error", reject)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("federation server has no TCP address")
  const baseUrl = `http://127.0.0.1:${address.port}/mcp`
  return {
    url: () => baseUrl,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
