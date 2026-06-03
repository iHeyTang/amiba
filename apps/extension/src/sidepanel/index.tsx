import "~lib/platform/init";

import "~style.css";

import { SessionsProvider } from "@hermes-x/core";
import { ChatSurface } from "@hermes-x/ui";
import { HomeView } from "@hermes-x/ui";
import { useMemo } from "react";

import { ChromeChatEngineClient } from "~lib/chat/chrome-engine-client";
import {
  chromeCapabilities,
  openAgentDestinationInUserWindow,
} from "~lib/chat/chrome-capabilities";

import { BridgeStatusBar } from "./BridgeStatusBar";
import { EmptyStateBridgeGate } from "./EmptyStateBridgeGate";
import { NavigateOpenPolicyToggle } from "./NavigateOpenPolicyToggle";

export type { MessagesMaxWidth, ChatSurfaceProps as SidePanelProps } from "@hermes-x/ui";

/**
 * Extension side-panel entry.
 *
 * This file is a thin wrapper around `<ChatSurface>` (shared between
 * extension and desktop). Everything visible — the TabBar, message bubbles,
 * composer, attachment chips, approval banner, session drawer — lives in
 * `@hermes-x/chat-ui`.
 *
 * What stays here is purely the extension-side wiring:
 *   - `ChromeChatEngineClient` — wraps `chrome.runtime.connect`
 *   - `chromeCapabilities`     — page-context, Learn, navigateOpenPolicy
 *   - the BridgeStatusBar + NavigateOpenPolicyToggle slot subtrees
 *   - `chrome.runtime.openOptionsPage()` callback
 *   - `openAgentDestinationInUserWindow` callback (chrome.windows + tabs)
 */
export default function SidePanel(props: {
  variant?: "sidebar" | "fullscreen";
  messagesMaxWidth?: "narrow" | "comfortable" | "full";
} = {}) {
  return (
    <SessionsProvider>
      <SidePanelInner {...props} />
    </SessionsProvider>
  );
}

function SidePanelInner(props: {
  variant?: "sidebar" | "fullscreen";
  messagesMaxWidth?: "narrow" | "comfortable" | "full";
}) {
  // Single client instance per panel mount; `useMemo` keeps it stable
  // across renders so the ChatSurface's subscription effect doesn't
  // re-bind on every state tick.
  const client = useMemo(() => new ChromeChatEngineClient(), []);

  return (
    <ChatSurface
      variant={props.variant}
      messagesMaxWidth={props.messagesMaxWidth}
      client={client}
      capabilities={chromeCapabilities}
      slots={{
        bridgeBar: <BridgeStatusBar messages={[]} />,
        navigateOpenPolicyToggle: ({ policy, onChange }) => (
          <NavigateOpenPolicyToggle policy={policy} onChange={onChange} />
        ),
        // Mirrors desktop: the empty state IS the home composer. HomeView
        // in panelMode drops its full-screen chrome and keeps just the
        // centred composer card. Submit calls `sessions.createNew()` and
        // writes the text to `home.pendingPrompt`; ChatSurface's drain
        // effect auto-sends inside the freshly-active session, so
        // `onOpenChat` is a no-op (we're already in the chat surface).
        // Capabilities are intentionally empty — the bookmark-shortcuts
        // strip belongs on the new-tab Home, not the narrow sidebar.
        // Wrapped in EmptyStateBridgeGate so the composer is replaced by
        // a Connect CTA whenever the bridge isn't reachable — submitting
        // a prompt would just error in that state.
        emptyState: (
          <EmptyStateBridgeGate>
            <HomeView
              onOpenChat={() => {}}
              onOpenSettings={() => chrome.runtime.openOptionsPage()}
              capabilities={{}}
              panelMode
            />
          </EmptyStateBridgeGate>
        ),
      }}
      openSettings={() => chrome.runtime.openOptionsPage()}
      openAgentDestination={openAgentDestinationInUserWindow}
    />
  );
}
