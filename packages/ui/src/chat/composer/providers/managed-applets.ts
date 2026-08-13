import type { ManagedAppsBridge } from "@amiba/managed-apps/bridge"
import type { LexicalEditor } from "lexical"

import { registerMentionType } from "../serialize"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

const TYPE = "amiba.resource"
registerMentionType(TYPE, ["appId", "revisionId", "provider", "uri", "title"])

function namespacedUri(appId: string, uri: string): string {
  return `amiba-applet://${encodeURIComponent(appId)}/${encodeURIComponent(uri)}`
}

function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!)
}

function isContextMimeAllowed(mimeType?: string): boolean {
  if (!mimeType) return true
  const mime = mimeType.split(";", 1)[0]!.trim().toLowerCase()
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml"
}

/** Host-owned projection of active Applet MCP Resources into the composer. */
export function makeManagedAppletMentionProvider(bridge: ManagedAppsBridge): TriggerProvider {
  return {
    trigger: "@",
    id: "managed-applets",
    group: "Applets",
    ownsType: TYPE,
    persistent: true,
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const apps = await bridge.list()
      const items: MenuItem[] = []
      for (const app of apps) {
        if (!app.activeRevision || app.userStatus === "unavailable") continue
        for (const mention of app.activeRevision.manifest.mentions ?? []) {
          if (mention.searchTool) {
            const [declaredProvider, ...toolParts] = mention.searchTool.split("/")
            const provider = toolParts.length ? declaredProvider : mention.provider
            const toolName = toolParts.length ? toolParts.join("/") : mention.searchTool
            try {
              const result = await bridge.callTool({
                appId: app.id,
                providerAlias: provider,
                name: toolName,
                arguments: { query, limit: 30 },
                revisionId: app.activeRevision.id,
              })
              for (const content of result.content) {
                if (content.type !== "resource_link" || typeof content.uri !== "string") continue
                const title = typeof content.name === "string" ? content.name : content.uri
                items.push({
                  id: `${app.id}:${mention.id}:${content.uri}`,
                  label: title,
                  description: app.name,
                  insert: {
                    type: TYPE,
                    display: title,
                    payload: {
                      appId: app.id,
                      revisionId: app.activeRevision.id,
                      provider,
                      uri: content.uri,
                      title,
                    },
                  },
                })
              }
            } catch {
              // A temporarily unhealthy search tool does not break other @ sources.
            }
          } else if (mention.resourceUriTemplate) {
            const uri = mention.resourceUriTemplate.replaceAll("{query}", encodeURIComponent(query))
            const label = query.trim() || mention.label
            items.push({
              id: `${app.id}:${mention.id}:${uri}`,
              label,
              description: app.name,
              insert: {
                type: TYPE,
                display: label,
                payload: {
                  appId: app.id,
                  revisionId: app.activeRevision.id,
                  provider: mention.provider,
                  uri,
                  title: label,
                },
              },
            })
          }
        }
      }
      return items
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(mention: MentionData): string {
      return `(Applet resource: ${mention.payload.title || mention.display} · ${namespacedUri(mention.payload.appId, mention.payload.uri)})`
    },
    async resolveMention(mention: MentionData): Promise<string> {
      const result = await bridge.readResource({
        appId: mention.payload.appId,
        providerAlias: mention.payload.provider,
        uri: mention.payload.uri,
        revisionId: mention.payload.revisionId,
      })
      let remaining = 96_000
      const content = result.contents.map((item) => {
        const value = typeof item.text === "string" && isContextMimeAllowed(item.mimeType)
          ? item.text
          : `[Resource content not injected: ${item.mimeType ?? "binary resource"} · ${item.uri}]`
        const chunk = value.slice(0, remaining)
        remaining = Math.max(0, remaining - chunk.length)
        return escapeXml(chunk)
      }).filter(Boolean).join("\n")
      return [
        `@${mention.payload.title || mention.display}`,
        `<amiba-resource applet="${escapeXml(mention.payload.appId)}" revision="${escapeXml(mention.payload.revisionId)}" uri="${escapeXml(mention.payload.uri)}" title="${escapeXml(mention.payload.title || mention.display)}" trust="untrusted-content">`,
        content,
        "</amiba-resource>",
      ].join("\n")
    },
  }
}
