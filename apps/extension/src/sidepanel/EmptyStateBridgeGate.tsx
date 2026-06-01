import { Loader2, PlugZap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useT } from "@hermes-x/i18n";
import { Button } from "@hermes-x/ui";

import type { ConnectionState } from "~lib/types";

interface StatusResponse {
  state?: ConnectionState;
}

/**
 * Empty-state bridge gate.
 *
 * Wraps the chat surface's empty state with a connection check: when
 * the bridge isn't reachable, the home composer is useless (every
 * submit would just error), so we hide it and show a single Connect
 * CTA instead. As soon as the SW broadcasts `connected`, the gate
 * falls through to `children` (HomeView panelMode).
 *
 * Mirrors the connect/refresh logic in `BridgeStatusBar` — chrome
 * runtime messages + the slow polling safety net — but renders a
 * prominent centred CTA instead of the tiny pill.
 */
export function EmptyStateBridgeGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const r = (await chrome.runtime.sendMessage({
        action: "status",
      })) as StatusResponse;
      setState(r?.state || "disconnected");
    } catch {
      setState("disconnected");
    }
  }

  useEffect(() => {
    void refresh();
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === "hermes:status-changed") void refresh();
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const id = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(id);
      chrome.runtime.onMessage.removeListener(onMsg);
    };
  }, []);

  if (state === "connected") return <>{children}</>;

  const connecting = state === "connecting" || busy;

  async function onConnect() {
    if (connecting) return;
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ action: "connect" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
        <PlugZap className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t("sidepanel.empty.notConnected.title")}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {t("sidepanel.empty.notConnected.description")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => void onConnect()}
        disabled={connecting}
        className="min-w-[7rem]"
      >
        {connecting ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {t("sidepanel.empty.notConnected.connecting")}
          </>
        ) : (
          t("sidepanel.empty.notConnected.button")
        )}
      </Button>
    </div>
  );
}
