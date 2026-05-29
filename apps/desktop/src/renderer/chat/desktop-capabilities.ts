/**
 * Desktop counterpart to `apps/extension/src/lib/chat/chrome-capabilities.ts`.
 *
 * The chat UI declares optional "platform capabilities" — small interfaces
 * that the chat package itself can't implement because they reach into
 * platform-specific APIs (chrome.* in the extension, the Electron bridge
 * here). When a capability is undefined, the corresponding feature simply
 * stays hidden / inert.
 *
 * Right now the only capability the desktop needs to wire is the
 * "pending prompt" hand-off from HomeView → chat: the home composer
 * stores `{ text, ts }` under `home.pendingPrompt` and navigates to the
 * chat view, expecting that view to drain the key and auto-send the
 * prompt. Without this capability the desktop hand-off silently created
 * an empty session — the storage write succeeded but nobody was reading
 * it back on the chat side.
 */
import type { SidePanelCapabilities } from "@hermes-x/chat-ui"
import { getPlatform } from "@hermes-x/platform"

const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt"

/**
 * Read + clear the pending prompt the HomeView stored before navigating
 * to chat. Match the chrome implementation exactly: remove on drain so
 * a remount / panel reopen never resends the same prompt.
 */
async function drainPendingPrompt(): Promise<string | null> {
  try {
    const storage = getPlatform().storage
    const r = await storage.get(HOME_PENDING_PROMPT_KEY)
    const raw = r[HOME_PENDING_PROMPT_KEY]
    await storage.remove(HOME_PENDING_PROMPT_KEY)
    if (!raw || typeof raw !== "object") return null
    const text = (raw as { text?: unknown }).text
    return typeof text === "string" && text.trim() ? text : null
  } catch {
    return null
  }
}

export const desktopCapabilities: SidePanelCapabilities = {
  pendingPrompt: { drain: drainPendingPrompt },
}
