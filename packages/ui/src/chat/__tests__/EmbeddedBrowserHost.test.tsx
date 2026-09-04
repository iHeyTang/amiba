import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { getPlatform } from "@amiba/app-runtime/platform";

import {
  EmbeddedBrowserHost,
  createEmbeddedBrowserResource,
  type SessionBrowserTab,
} from "../EmbeddedBrowserPane";

function attach(browserTabId: string, webContentsId: number) {
  const host = document.querySelector("[data-embedded-browser-host]");
  const container = host?.querySelector(
    `[data-embedded-browser-tab="${browserTabId}"]`,
  );
  const webview = container?.firstElementChild as
    | (HTMLElement & { getWebContentsId(): number })
    | null;
  if (!webview) throw new Error(`no <webview> mounted for ${browserTabId}`);
  webview.getWebContentsId = () => webContentsId;
  webview.dispatchEvent(new Event("dom-ready"));
  return webview;
}

describe("EmbeddedBrowserHost", () => {
  const platform = getPlatform() as unknown as Record<string, unknown>;
  const previous = platform.embeddedBrowser;
  afterEach(() => {
    platform.embeddedBrowser = previous;
  });

  it("mounts a webview for a background session and registers it as that session's", () => {
    const registerTab = vi.fn().mockResolvedValue({
      tab_id: "",
      url: "about:blank",
      title: "",
      can_go_back: false,
      can_go_forward: false,
      loading: false,
    });
    platform.embeddedBrowser = {
      registerTab,
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      detectDevServers: vi.fn().mockResolvedValue([]),
      onCreateRequested: () => () => {},
      onFocusRequested: () => () => {},
      onAgentActivity: () => () => {},
    };

    const background = createEmbeddedBrowserResource(
      "tab-background-0-0-0" as never,
    );
    const visible = createEmbeddedBrowserResource("tab-visible-0-0-0" as never);
    visible.url = "https://example.com";
    const tabs: SessionBrowserTab[] = [
      { sessionId: "session-background", resource: background },
      { sessionId: "session-visible", resource: visible },
    ];

    render(
      <EmbeddedBrowserHost
        tabs={tabs}
        shownSessionId="session-visible"
        shownTabId="tab-visible-0-0-0"
        onUpdateTab={() => {}}
      >
        <div />
      </EmbeddedBrowserHost>,
    );

    // The background session has no workbench on screen, so this host is the
    // only place its <webview> can exist — without it main's registration
    // wait just times out.
    attach("tab-background-0-0-0", 41);
    expect(registerTab).toHaveBeenCalledWith({
      tabId: "tab-background-0-0-0",
      webContentsId: 41,
      active: false,
      sessionId: "session-background",
    });

    attach("tab-visible-0-0-0", 42);
    expect(registerTab).toHaveBeenLastCalledWith({
      tabId: "tab-visible-0-0-0",
      webContentsId: 42,
      active: true,
      sessionId: "session-visible",
    });
  });
});
