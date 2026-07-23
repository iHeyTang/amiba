/**
 * Desktop counterpart to `apps/browser-extension/src/lib/chat/chrome-capabilities.ts`.
 *
 * The chat UI declares optional "platform capabilities" — small interfaces
 * that the chat package itself can't implement because they reach into
 * platform-specific APIs (chrome.* in the extension, the Electron bridge
 * here). When a capability is undefined, the corresponding feature simply
 * stays hidden / inert.
 *
 * Desktop wires the "pending prompt" hand-off, which is fed by multiple
 * surfaces in main:
 *   - HomeView (in the same renderer) — text prompt
 *   - Quick-Ask Spotlight — text + sourceApp
 *   - Region Snip — image attachment + best-effort OCR text
 *   - `amiba://` URL handler — text prompt
 *   - Unix socket inbox — text + optional attachments
 * Everything funnels through the same `home.pendingPrompt` key with the
 * shape `{ text?, attachments?, sourceApp?, workspacePath? }`.
 */
import type {
  PendingPromptAttachment,
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "@amiba/ui"
import { getPlatform } from "@amiba/platform"

const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt"

function coerceKind(value: unknown): PendingPromptAttachment["kind"] {
  if (value === "image" || value === "text" || value === "pdf") return value
  return "binary"
}

function normalizeAttachment(raw: unknown): PendingPromptAttachment | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const path = typeof r.path === "string" ? r.path : ""
  if (!path) return null
  const name =
    typeof r.name === "string" && r.name
      ? r.name
      : path.split(/[\\/]/).pop() || "file"
  return {
    uiId:
      typeof r.uiId === "string" && r.uiId
        ? r.uiId
        : `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime: typeof r.mime === "string" ? r.mime : "application/octet-stream",
    size:
      typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
    kind: coerceKind(r.kind),
    path,
    thumbDataUrl:
      typeof r.thumbDataUrl === "string" ? r.thumbDataUrl : undefined,
    textPreview:
      typeof r.textPreview === "string" ? r.textPreview : undefined,
  }
}

/**
 * Read + clear the pending prompt that a hand-off surface stored before
 * raising the chat window. Remove on drain so a remount / panel reopen
 * never resends the same prompt.
 */
async function drainPendingPrompt(): Promise<PendingPromptResult | null> {
  try {
    const storage = getPlatform().storage
    const r = await storage.get(HOME_PENDING_PROMPT_KEY)
    const raw = r[HOME_PENDING_PROMPT_KEY]
    await storage.remove(HOME_PENDING_PROMPT_KEY)
    if (!raw || typeof raw !== "object") return null
    const obj = raw as {
      text?: unknown
      attachments?: unknown
      sourceApp?: unknown
      workspacePath?: unknown
    }
    const text =
      typeof obj.text === "string" && obj.text.trim() ? obj.text : undefined
    const sourceApp =
      typeof obj.sourceApp === "string" && obj.sourceApp.trim()
        ? obj.sourceApp
        : undefined
    const workspacePath =
      typeof obj.workspacePath === "string" && obj.workspacePath.trim()
        ? obj.workspacePath
        : undefined
    let attachments: PendingPromptAttachment[] | undefined
    if (Array.isArray(obj.attachments)) {
      const out: PendingPromptAttachment[] = []
      for (const item of obj.attachments) {
        const norm = normalizeAttachment(item)
        if (norm) out.push(norm)
      }
      if (out.length > 0) attachments = out
    }
    if (!text && !attachments) return null
    return { text, attachments, sourceApp, workspacePath }
  } catch {
    return null
  }
}

/**
 * Subscribe to writes against the pending-prompt key so the chat
 * surface can re-drain when a new payload lands while it's already
 * mounted. Critical for the in-window home-composer hand-off: when
 * the empty-state HomeView submits into an already-active empty
 * session, ``sessions.activeId`` doesn't change, so the once-per-id
 * drain effect would otherwise miss the freshly-written payload.
 *
 * Fires only on transitions where the key gains a value (the storage
 * watcher emits a change for the ``remove`` step too — we don't want
 * to re-drain immediately after the chat surface just consumed the
 * payload itself).
 */
function subscribePendingPrompt(onChanged: () => void): () => void {
  const storage = getPlatform().storage
  return storage.watch([HOME_PENDING_PROMPT_KEY], (changes) => {
    const ch = changes[HOME_PENDING_PROMPT_KEY]
    if (!ch) return
    if (ch.newValue == null) return
    onChanged()
  })
}

export const desktopCapabilities: ChatSurfaceCapabilities = {
  pendingPrompt: {
    drain: drainPendingPrompt,
    subscribe: subscribePendingPrompt,
  },
}
