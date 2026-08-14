import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react"

import type { McpAppsViewBridge, McpToolResult } from "./types"

export interface McpAppsViewProps {
  extensionId: string
  providerAlias?: string
  html: string
  bridge: McpAppsViewBridge
  theme?: "light" | "dark"
  locale?: string
  className?: string
  style?: CSSProperties
  toolInput?: Record<string, unknown>
  toolResult?: McpToolResult
  permissions?: string[]
  onReady?: () => void
  onError?: (error: Error) => void
}

function textFromMessage(content: Array<Record<string, unknown>>): string {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim()
}

function sandboxPermissions(permissions: string[]): string | undefined {
  const allowed: string[] = []
  if (permissions.includes("camera")) allowed.push("camera")
  if (permissions.includes("microphone")) allowed.push("microphone")
  if (permissions.includes("geolocation")) allowed.push("geolocation")
  if (permissions.includes("clipboard-write")) allowed.push("clipboard-write")
  return allowed.length ? allowed.join("; ") : undefined
}

/**
 * Standards-only MCP Apps host. The iframe has no same-origin privilege and
 * receives host services exclusively through MCP Apps JSON-RPC messages.
 */
export function McpAppsView({
  extensionId,
  providerAlias = "main",
  html,
  bridge: host,
  theme = "light",
  locale = "zh-CN",
  className,
  style,
  toolInput,
  toolResult,
  permissions = [],
  onReady,
  onError,
}: McpAppsViewProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const activeBridge = useRef<AppBridge | null>(null)
  const [connected, setConnected] = useState(false)
  const allow = useMemo(() => sandboxPermissions(permissions), [permissions])
  const permissionKey = useMemo(() => [...permissions].sort().join("\0"), [permissions])

  useEffect(() => {
    if (!connected || !activeBridge.current) return
    activeBridge.current.setHostContext({
      theme,
      locale,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: "desktop",
      displayMode: "fullscreen",
      availableDisplayModes: ["fullscreen"],
    })
  }, [connected, locale, theme])

  useEffect(() => {
    if (!connected || !toolInput) return
    void activeBridge.current?.sendToolInput({ arguments: toolInput })
  }, [connected, toolInput])

  useEffect(() => {
    if (!connected || !toolResult) return
    void activeBridge.current?.sendToolResult(toolResult as never)
  }, [connected, toolResult])

  async function connect(): Promise<void> {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const next = new AppBridge(
      null,
      { name: "Amiba", version: "0.1.0" },
      { openLinks: {}, serverTools: {}, serverResources: {} },
      {
        hostContext: {
          theme,
          locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: "desktop",
          displayMode: "fullscreen",
          availableDisplayModes: ["fullscreen"],
        },
      },
    )
    next.oncalltool = async ({ name, arguments: args }) =>
      host.callTool({
        extensionId,
        providerAlias,
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      }) as never
    next.onreadresource = async ({ uri }) =>
      host.readResource({ extensionId, providerAlias, uri }) as never
    next.onopenlink = async ({ url }) => {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { isError: true }
      if (
        !permissions.includes("open-external") &&
        !permissions.includes(`network:${parsed.origin}`)
      ) {
        return { isError: true }
      }
      await host.openLink(url)
      return {}
    }
    next.onmessage = async ({ content }) => {
      if (!permissions.includes("agent:message")) return { isError: true }
      const text = textFromMessage(content as Array<Record<string, unknown>>)
      if (!text) return { isError: true }
      await host.sendMessage(text)
      return {}
    }
    next.onrequestdisplaymode = async () => ({ mode: "fullscreen" })
    next.onupdatemodelcontext = async () => ({})
    next.oninitialized = () => {
      setConnected(true)
      onReady?.()
    }
    activeBridge.current = next
    try {
      await next.connect(new PostMessageTransport(target, target))
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      onError?.(cause)
    }
  }

  useEffect(() => () => {
    const current = activeBridge.current
    activeBridge.current = null
    setConnected(false)
    if (current) void current.teardownResource({}).catch(() => current.close().catch(() => {}))
  }, [html, permissionKey, providerAlias])

  return (
    <iframe
      key={`${extensionId}:${providerAlias}:${permissionKey}`}
      ref={iframeRef}
      title="Extension"
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-downloads"
      allow={allow}
      className={className}
      style={{ border: 0, display: "block", width: "100%", height: "100%", ...style }}
      onLoad={() => void connect()}
    />
  )
}
