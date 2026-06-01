import "~lib/platform/init";

import "~style.css";

import { SessionsProvider } from "@hermes-x/core";
import { HomeView } from "@hermes-x/home-ui";

import { chromeHomeCapabilities } from "~lib/home/chrome-capabilities";

/**
 * Extension new-tab page — thin wrapper around the shared `<HomeView />`.
 *
 * Extension provides:
 *   - `chrome.bookmarks`-backed shortcuts capability,
 *   - `_favicon/` URL builder for cards,
 *   - chat-tab navigation via `chrome.runtime.getURL("tabs/chat.html")`,
 *   - options page via `chrome.runtime.openOptionsPage()`.
 *
 * Desktop renders the same `<HomeView />` directly in its main window,
 * with capabilities omitted (no bookmarks / no favicon service) and
 * navigation handled by an in-window state machine.
 */
export default function NewTab() {
  function openChatTab() {
    try {
      window.location.replace(chrome.runtime.getURL("tabs/chat.html"));
    } catch {
      // Best-effort.
    }
  }
  return (
    <SessionsProvider>
      <HomeView
        onOpenChat={openChatTab}
        onOpenSettings={() => chrome.runtime.openOptionsPage()}
        capabilities={chromeHomeCapabilities}
      />
    </SessionsProvider>
  );
}
