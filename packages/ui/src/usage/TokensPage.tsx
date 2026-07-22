/**
 * Tokens page shell — the "Tokens" sidebar destination.
 *
 * No page chrome: the sidebar row already names the view, and freshness
 * is app-guaranteed (load on mount, refetch on window focus, 30 s poll
 * while visible — see TokensTab), so there is neither a title bar nor a
 * refresh affordance. Just the layout container over the panel.
 */

import { TokensTab } from "./TokensTab"

export function TokensPage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <TokensTab />
    </div>
  )
}
