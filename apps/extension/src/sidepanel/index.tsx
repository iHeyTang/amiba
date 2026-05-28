import "~lib/platform/init";

import "~style.css";

import { SidePanelView } from "@hermes-x/chat-ui";
import { useMemo } from "react";

import { ChromeChatEngineClient } from "~lib/chat/chrome-engine-client";
import {
  chromeCapabilities,
  openAgentDestinationInUserWindow,
} from "~lib/chat/chrome-capabilities";

import { BridgeStatusBar } from "./BridgeStatusBar";
import { NavigateOpenPolicyToggle } from "./NavigateOpenPolicyToggle";

export type { MessagesMaxWidth, SidePanelViewProps as SidePanelProps } from "@hermes-x/chat-ui";

/**
 * Extension side-panel entry.
 *
 * This file is a thin wrapper around `<SidePanelView>` (shared between
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
  // Single client instance per panel mount; `useMemo` keeps it stable
  // across renders so the SidePanelView's subscription effect doesn't
  // re-bind on every state tick.
  const client = useMemo(() => new ChromeChatEngineClient(), []);

  return (
    <SidePanelView
      variant={props.variant}
      messagesMaxWidth={props.messagesMaxWidth}
      client={client}
      capabilities={chromeCapabilities}
      slots={{
        bridgeBar: <BridgeStatusBar messages={[]} />,
        navigateOpenPolicyToggle: ({ policy, onChange }) => (
          <NavigateOpenPolicyToggle policy={policy} onChange={onChange} />
        ),
      }}
      openSettings={() => chrome.runtime.openOptionsPage()}
      openAgentDestination={openAgentDestinationInUserWindow}
    />
  );
}
