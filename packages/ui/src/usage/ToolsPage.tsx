/** Profile-scoped tool access, grouped by built-in and external sources. */

import type { ToolActivitySource } from "@amiba/core"

import { AgentCapabilitiesPage } from "./AgentCapabilitiesPage"

export interface ToolsPageProps {
  embedded?: boolean
  profileId?: string
  toolActivitySource?: ToolActivitySource
}

export function ToolsPage({
  embedded = false,
  profileId,
  toolActivitySource,
}: ToolsPageProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AgentCapabilitiesPage
        embedded={embedded}
        profileId={profileId}
        toolActivitySource={toolActivitySource}
      />
    </div>
  )
}
