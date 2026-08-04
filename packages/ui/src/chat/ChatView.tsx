import type { ChatEngineClient, SessionMeta } from "@amiba/core";
import { ScrollArea } from "../primitives";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Composer } from "./Composer";
import { EmptyState } from "./bubble/chips";
import { ErrorBlock } from "./bubble/chips";
import { MessageTurns } from "./bubble/Bubble";
import { SessionDrawer } from "./SessionDrawer";
import { TabBar } from "./TabBar";
import type { ChatError, UiMessage } from "./internal/types";

export interface ChatViewProps {
  /** Engine the view talks to. Provided by each app (Chrome port / Electron IPC). */
  client: ChatEngineClient;

  /** Sessions known to the view (active + open tabs + history). */
  sessions: SessionMeta[];
  activeId: string;
  openTabIds: string[];

  /** Messages for the active session — owned by the parent. */
  messages: UiMessage[];

  /** True while the engine is streaming a reply for the active session. */
  busy?: boolean;

  /** Optional top-level error banner shown above the messages. */
  error?: ChatError | null;

  // Session controls (parent owns persistence).
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseMany: (ids: string[]) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings?: (tab?: string) => void;

  // Composer
  onSubmitMessage: (text: string) => void;

  /**
   * Open the agent-destination URL stamped on a finished assistant bubble.
   * Extension impl uses chrome.windows + chrome.tabs to land in the user's
   * window; desktop impl defers to `shell.openExternal`.
   */
  onOpenAgentDestination?: (url: string) => void | Promise<void>;

  /**
   * Optional row above the composer textarea — extension uses it for the
   * page-context chip / Learn record button / NavigateOpenPolicyToggle.
   */
  composerExtrasAbove?: ReactNode;

  /**
   * Optional row inserted between the TabBar and the message list — extension
   * uses it for the BridgeStatusBar.
   */
  headerExtras?: ReactNode;
}

export function ChatView({
  client,
  sessions,
  activeId,
  openTabIds,
  messages,
  busy,
  error,
  onActivate,
  onClose,
  onCloseMany,
  onNew,
  onRename,
  onDelete,
  onOpenSettings,
  onSubmitMessage,
  onOpenAgentDestination,
  composerExtrasAbove,
  headerExtras,
}: ChatViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [input, setInput] = useState("");

  const tabs = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    return openTabIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionMeta => Boolean(s));
  }, [sessions, openTabIds]);

  // Subscribe to the active session's stream whenever it changes.
  const lastSubRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId) return;
    if (lastSubRef.current === activeId) return;
    lastSubRef.current = activeId;
    client.subscribe(activeId);
  }, [client, activeId]);

  // Composer hands us mention-expanded agent-facing text, so the backend
  // never sees raw `@[type:payload]` tokens.
  function handleSubmit(text: string) {
    text = text.trim();
    if (!text) return;
    setInput("");
    onSubmitMessage(text);
  }

  function handleAbort() {
    if (!activeId) return;
    client.abort(activeId);
  }

  const noActiveSession = !activeId;
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onActivate={onActivate}
        onClose={onClose}
        onCloseMany={onCloseMany}
        onNew={onNew}
        onOpenHistory={() => setDrawerOpen(true)}
        onOpenSettings={onOpenSettings ?? (() => {})}
      />

      {headerExtras ? (
        <div className="border-b border-border">{headerExtras}</div>
      ) : null}

      <div className="relative flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-2 p-3" data-selection="text">
            {noActiveSession || !hasMessages ? (
              <EmptyState
                hasHistory={sessions.length > 0}
                onNew={onNew}
                onOpenHistory={() => setDrawerOpen(true)}
              />
            ) : (
              <MessageTurns
                messages={messages}
                onOpenAgentDestination={onOpenAgentDestination}
              />
            )}

            {error && (
              <div className="flex justify-center pt-2">
                <ErrorBlock
                  error={error}
                  onOpenSettings={onOpenSettings ?? (() => {})}
                />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        busy={busy}
        onAbort={handleAbort}
        extrasAbove={composerExtrasAbove}
      />

      <SessionDrawer
        open={drawerOpen}
        sessions={sessions}
        openTabIds={openTabIds}
        activeId={activeId}
        onClose={() => setDrawerOpen(false)}
        onOpen={(id) => {
          onActivate(id);
          setDrawerOpen(false);
        }}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}
