import type {
  ActiveTabInfo,
  BrowserTabSnapshot,
  LearnCapability,
  LearnStatus,
  LearnTraceResult,
  NavigateOpenPolicy,
  NavigateOpenPolicyCapability,
  PageContextCapability,
  PageContextSnapshot,
  PendingPromptAttachment,
  PendingPromptCapability,
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "@amiba/ui";

import {
  capturePageContext,
  formatPageContextsForPrompt,
  getActiveBrowserTab,
  getPageRestrictedReason,
} from "~lib/page-context/capture";
import { useActiveTab as useActiveTabHook } from "~lib/page-context/use-active-tab";

// ---------------------------------------------------------------------------
// page-context
// ---------------------------------------------------------------------------

export const chromePageContext: PageContextCapability = {
  async capturePage(): Promise<PageContextSnapshot | null> {
    const result = await capturePageContext();
    if (result.kind === "error") return null;
    return result.page as unknown as PageContextSnapshot;
  },

  async getActiveBrowserTab(): Promise<ActiveTabInfo | null> {
    const tab = await getActiveBrowserTab();
    if (!tab) return null;
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
    };
  },

  async captureBrowserTabSnapshot(): Promise<BrowserTabSnapshot | null> {
    // Identify the tab first so the snapshot always carries tab_id /
    // window_id, even on restricted URLs where we skip the DOM extract.
    const tab = await getActiveBrowserTab();
    if (!tab || !tab.url) return null;

    const captured_at = Date.now();
    const base: BrowserTabSnapshot = {
      tab_id: tab.id,
      window_id: tab.windowId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favIconUrl,
      captured_at,
    };

    // Skip the scripting injection on restricted pages (chrome://, the
    // Web Store, etc.) — capturePageContext would error out anyway. The
    // metadata-only snapshot is still useful: the agent at least knows
    // which page the user meant to ask about, even if it can't see the
    // body.
    if (getPageRestrictedReason(tab.url)) return base;

    try {
      const result = await capturePageContext();
      if (result.kind !== "page") return base;
      const page = result.page;
      return {
        ...base,
        url: page.url || base.url,
        title: page.title || base.title,
        favicon: page.favicon ?? base.favicon,
        text: page.content,
        truncated: page.truncated,
        full_length: page.originalLength,
      };
    } catch {
      // Extraction failure → still ship metadata; the agent's reply might
      // not need the body, and reaching for a stale-snapshot fallback is
      // better than blocking send on a flaky page.
      return base;
    }
  },

  formatPageContextsForPrompt: (snapshots) =>
    formatPageContextsForPrompt(
      snapshots as unknown as Parameters<typeof formatPageContextsForPrompt>[0]
    ),

  getPageRestrictedReason: (url) => getPageRestrictedReason(url),

  useActiveTab: () => {
    const { tab, refresh } = useActiveTabHook();
    return {
      tab: tab
        ? {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            favIconUrl: tab.favIconUrl,
          }
        : null,
      refresh,
    };
  },
};

// ---------------------------------------------------------------------------
// learn (record-mode)
// ---------------------------------------------------------------------------

export const chromeLearn: LearnCapability = {
  async getStatus(): Promise<LearnStatus> {
    const r = (await chrome.runtime.sendMessage({ action: "learn.status" })) as {
      ok?: boolean;
      active?: boolean;
      eventCount?: number;
    };
    return {
      active: !!r?.ok && !!r.active,
      eventCount: r?.ok && typeof r.eventCount === "number" ? r.eventCount : 0,
    };
  },

  async start(tabId: number): Promise<{ ok: boolean; error?: string }> {
    const r = (await chrome.runtime.sendMessage({
      action: "learn.start",
      tabId,
    })) as { ok?: boolean; error?: string };
    return { ok: !!r?.ok, error: r?.error };
  },

  async stop(): Promise<LearnTraceResult> {
    const r = (await chrome.runtime.sendMessage({ action: "learn.stop" })) as {
      ok?: boolean;
      trace?: unknown;
      error?: string;
    };
    return { ok: !!r?.ok, trace: r?.trace, error: r?.error };
  },

  onStateChange(cb: (status: LearnStatus) => void): () => void {
    const handler = (msg: { type?: string }) => {
      if (msg?.type !== "learn:state") return;
      // Re-fetch status and forward; the SW only emits a "changed" tick.
      void chromeLearn.getStatus().then(cb);
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  },
};

// ---------------------------------------------------------------------------
// navigateOpenPolicy
// ---------------------------------------------------------------------------

async function applyOpenPolicyToRunTarget(policy: NavigateOpenPolicy): Promise<void> {
  if (policy === "auto") return;
  if (policy === "agent") {
    await chrome.runtime.sendMessage({ action: "runTarget.set", target: "agent" });
    return;
  }
  const win = await chrome.windows.getCurrent();
  const wid = win.id;
  if (wid === undefined) return;
  const [activeUserTab] = await chrome.tabs.query({ active: true, windowId: wid });
  await chrome.runtime.sendMessage({
    action: "runTarget.set",
    target: "user",
    userTabId: activeUserTab?.id ?? null,
    userWindowId: wid,
  });
}

export const chromeNavigateOpenPolicy: NavigateOpenPolicyCapability = {
  async apply(policy: NavigateOpenPolicy): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        action: "navigateOpenPolicy.set",
        policy,
      });
    } catch {
      // SW may not be ready.
    }
    await applyOpenPolicyToRunTarget(policy);
  },

  onChange(cb: (policy: NavigateOpenPolicy) => void): () => void {
    const handler = (msg: { type?: string; navigateOpenPolicy?: string }) => {
      if (msg?.type !== "amiba:navigate-open-policy-changed") return;
      const p = msg.navigateOpenPolicy;
      if (
        p === "auto" ||
        p === "agent" ||
        p === "user_new_tab" ||
        p === "user_same_tab"
      ) {
        cb(p);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  },
};

// ---------------------------------------------------------------------------
// pending prompt (home-launcher hand-off)
// ---------------------------------------------------------------------------

const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt";

function coerceAttachmentKind(value: unknown): PendingPromptAttachment["kind"] {
  if (value === "image" || value === "text" || value === "pdf") return value;
  return "binary";
}

function normalizePendingAttachment(raw: unknown): PendingPromptAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? r.path : "";
  if (!path) return null;
  const name =
    typeof r.name === "string" && r.name
      ? r.name
      : path.split(/[\\/]/).pop() || "file";
  return {
    uiId:
      typeof r.uiId === "string" && r.uiId
        ? r.uiId
        : `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime: typeof r.mime === "string" ? r.mime : "application/octet-stream",
    size:
      typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
    kind: coerceAttachmentKind(r.kind),
    path,
    thumbDataUrl:
      typeof r.thumbDataUrl === "string" ? r.thumbDataUrl : undefined,
    textPreview:
      typeof r.textPreview === "string" ? r.textPreview : undefined,
  };
}

export const chromePendingPrompt: PendingPromptCapability = {
  /**
   * Read + clear the pending-prompt payload that a hand-off surface
   * (HomeView panel-mode composer, Quick-Ask Spotlight, snip, etc.)
   * stored before the chat surface mounted or before the user activated
   * a fresh session. Returns the full
   * `{ text, attachments, sourceApp, workspacePath }` shape — mirroring
   * desktop — so attachments, source chips, and draft workspace metadata
   * survive the round-trip. Returning `null` means there was nothing pending.
   */
  async drain(): Promise<PendingPromptResult | null> {
    try {
      const r = await chrome.storage.local.get(HOME_PENDING_PROMPT_KEY);
      const raw = r[HOME_PENDING_PROMPT_KEY];
      await chrome.storage.local.remove(HOME_PENDING_PROMPT_KEY);
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as {
        text?: unknown;
        attachments?: unknown;
        sourceApp?: unknown;
        workspacePath?: unknown;
        agent?: unknown;
      };
      const text =
        typeof obj.text === "string" && obj.text.trim()
          ? obj.text
          : undefined;
      const sourceApp =
        typeof obj.sourceApp === "string" && obj.sourceApp.trim()
          ? obj.sourceApp
          : undefined;
      const workspacePath =
        typeof obj.workspacePath === "string" && obj.workspacePath.trim()
          ? obj.workspacePath
          : undefined;
      const rawAgent =
        obj.agent && typeof obj.agent === "object"
          ? (obj.agent as Record<string, unknown>)
          : null;
      const agent =
        rawAgent && typeof rawAgent.profileId === "string"
          ? {
              profileId: rawAgent.profileId,
              ...(rawAgent.personality &&
              typeof rawAgent.personality === "object" &&
              typeof (rawAgent.personality as Record<string, unknown>).key ===
                "string" &&
              typeof (rawAgent.personality as Record<string, unknown>).prompt ===
                "string"
                ? {
                    personality: rawAgent.personality as {
                      key: string;
                      prompt: string;
                    },
                  }
                : {}),
            }
          : undefined;
      let attachments: PendingPromptAttachment[] | undefined;
      if (Array.isArray(obj.attachments)) {
        const out: PendingPromptAttachment[] = [];
        for (const item of obj.attachments) {
          const norm = normalizePendingAttachment(item);
          if (norm) out.push(norm);
        }
        if (out.length > 0) attachments = out;
      }
      if (!text && !attachments) return null;
      return { text, attachments, sourceApp, workspacePath, agent };
    } catch {
      return null;
    }
  },
  /**
   * Push-subscribe to chrome.storage.local writes against the pending-
   * prompt key. Critical for the in-window HomeView hand-off: when the
   * empty-state composer submits into an already-active empty session,
   * `sessions.activeId` doesn't change, so the once-per-id drain effect
   * would otherwise miss the freshly-written payload. The chat surface
   * uses this signal to re-drain.
   *
   * Fires only when the key gains a value — chrome.storage.onChanged
   * also emits for the `remove` step inside `drain()`, and re-draining
   * on that echo would noisily clear an empty key on every consumption.
   */
  subscribe(onChanged: () => void): () => void {
    const handler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      const ch = changes[HOME_PENDING_PROMPT_KEY];
      if (!ch) return;
      if (ch.newValue == null) return;
      onChanged();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

// ---------------------------------------------------------------------------
// composed bundle for the ChatSurface consumer
// ---------------------------------------------------------------------------

export const chromeCapabilities: ChatSurfaceCapabilities = {
  pageContext: chromePageContext,
  learn: chromeLearn,
  navigateOpenPolicy: chromeNavigateOpenPolicy,
  pendingPrompt: chromePendingPrompt,
};

// ---------------------------------------------------------------------------
// "open in user window" helper for the AgentDestinationChip
// ---------------------------------------------------------------------------

export async function openAgentDestinationInUserWindow(url: string): Promise<void> {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.tabs.create({ url, active: true, windowId: win.id });
    try {
      if (win.id !== undefined) {
        await chrome.windows.update(win.id, { focused: true });
      }
    } catch {
      // Best effort.
    }
  } catch {
    try {
      await chrome.tabs.create({ url, active: true });
    } catch (e) {
      console.warn("[chrome-capabilities] open in browser failed:", e);
    }
  }
}
