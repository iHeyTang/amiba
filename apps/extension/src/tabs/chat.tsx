import "~lib/platform/init";

import "~style.css";

import { SessionsProvider } from "@hermes-x/core";
import { FullScreenChatView } from "@hermes-x/ui";
import { useMemo } from "react";

import { ChromeChatEngineClient } from "~lib/chat/chrome-engine-client";
import {
  chromeCapabilities,
  openAgentDestinationInUserWindow,
} from "~lib/chat/chrome-capabilities";

import { BridgeStatusBar } from "../sidepanel/BridgeStatusBar";
import { NavigateOpenPolicyToggle } from "../sidepanel/NavigateOpenPolicyToggle";

/**
 * Extension full-screen chat tab — thin wrapper around the shared
 * `<FullScreenChatView />` (lifted from this file's original 566 LOC).
 *
 * Chat surface, sessions rail, top bar, width toggle — all shared with
 * desktop. Extension just supplies the chrome.* wiring (ChromeChatEngineClient,
 * page-context / Learn / NavigateOpenPolicy capabilities, BridgeStatusBar
 * slot, openSettings, openAgentDestinationInUserWindow) and an `onGoHome`
 * that does an in-page redirect to `newtab.html`.
 */
export default function ChatTab() {
  return (
    <SessionsProvider>
      <ChatTabInner />
    </SessionsProvider>
  );
}

function ChatTabInner() {
  const client = useMemo(() => new ChromeChatEngineClient(), []);
  return (
    <FullScreenChatView
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
      onGoHome={() => {
        try {
          window.location.replace(chrome.runtime.getURL("newtab.html"));
        } catch {
          // Best-effort.
        }
      }}
    />
  );
}
