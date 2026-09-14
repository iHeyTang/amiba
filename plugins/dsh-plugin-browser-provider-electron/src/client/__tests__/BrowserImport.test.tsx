import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserAdapterContext } from "../adapter.js";
import {
  EmbeddedBrowserHost,
  EmbeddedBrowserWorkspace,
  createEmbeddedBrowserResource,
} from "../EmbeddedBrowserPane.js";
import type { EmbeddedBrowserAdapter } from "../../shared/browser.js";

vi.mock("@amiba/i18n/plugin", () => ({
  usePluginT: (messages: { en: Record<string, string> }) => ({
    t: (key: string) => messages.en[key] ?? key,
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("parks a loaded page while importing and restores the same webview on close", async () => {
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flushFrame = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 500,
    top: 100,
    width: 640,
    height: 480,
    right: 1140,
    bottom: 580,
    x: 500,
    y: 100,
    toJSON() {},
  });
  const adapter = {
    registerTab: vi.fn().mockResolvedValue({}),
    unregisterTab: vi.fn().mockResolvedValue(undefined),
    onAgentActivity: () => () => {},
    cookieImport: {
      sources: vi.fn().mockResolvedValue({ supported: true, sources: [] }),
    },
  } as unknown as EmbeddedBrowserAdapter;
  const tab = {
    ...createEmbeddedBrowserResource("loaded-page-0-0-0"),
    url: "https://example.com",
  };
  render(
    <BrowserAdapterContext.Provider value={adapter}>
      <EmbeddedBrowserHost
        tabs={[{ sessionId: "session", resource: tab }]}
        shownSessionId="session"
        shownTabId={tab.browserTabId}
        onUpdateTab={() => {}}
      >
        <EmbeddedBrowserWorkspace
          tabs={[tab]}
          activeTabId={tab.browserTabId}
          visible
          onUpdateTab={() => {}}
          onNewTab={() => {}}
        />
      </EmbeddedBrowserHost>
    </BrowserAdapterContext.Provider>,
  );
  flushFrame();
  const host = document.querySelector<HTMLElement>(
    "[data-embedded-browser-host]",
  )!;
  const webview = host.querySelector("webview");
  expect(host.style.left).toBe("500px");

  // Repeat to catch stale positioning after reopening, too.
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(
      screen.getByRole("button", { name: "Bring your logins with you" }),
    );
    await screen.findByText("No browser found yet");
    flushFrame();
    expect(host.style.left).toBe("-20000px");
    fireEvent.click(screen.getByRole("button", { name: "Close import" }));
    flushFrame();
    expect(host.style.left).toBe("500px");
    expect(host.querySelector("webview")).toBe(webview);
    expect(adapter.unregisterTab).not.toHaveBeenCalled();
  }
});
