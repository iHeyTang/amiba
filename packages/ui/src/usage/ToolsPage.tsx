/**
 * Tools page shell — the "Tools" sidebar destination.
 *
 * A single master/detail workspace (ManageTab): the left rail leads
 * with Home — the tool-activity dashboard and the landing view — then
 * the Built-in / Installed (MCP) management lanes; the right pane
 * renders whichever is selected.
 *
 * No page chrome: the sidebar row already names the view, and freshness
 * is app-guaranteed (mount + focus refetch + ledger push), so there is
 * neither a title bar nor a refresh button.
 */

import type { ToolActivitySource } from "@amiba/core"

import { ManageTab } from "./ManageTab"

export interface ToolsPageProps {
  toolActivitySource?: ToolActivitySource
}

export function ToolsPage({ toolActivitySource }: ToolsPageProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ManageTab toolActivitySource={toolActivitySource} />
    </div>
  )
}
