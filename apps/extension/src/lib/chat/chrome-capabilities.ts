import type {
  ActiveTabInfo,
  LearnCapability,
  LearnStatus,
  LearnTraceResult,
  NavigateOpenPolicy,
  NavigateOpenPolicyCapability,
  PageContextCapability,
  PageContextSnapshot,
  PendingPromptCapability,
  SidePanelCapabilities,
} from "@hermes-x/chat-ui";

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
      if (msg?.type !== "hermes:navigate-open-policy-changed") return;
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

export const chromePendingPrompt: PendingPromptCapability = {
  async drain(): Promise<string | null> {
    const KEY = "home.pendingPrompt";
    try {
      const r = await chrome.storage.local.get(KEY);
      const raw = r[KEY];
      await chrome.storage.local.remove(KEY);
      if (!raw || typeof raw !== "object") return null;
      const text = (raw as { text?: unknown }).text;
      return typeof text === "string" && text.trim() ? text : null;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// composed bundle for the SidePanelView consumer
// ---------------------------------------------------------------------------

export const chromeCapabilities: SidePanelCapabilities = {
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
