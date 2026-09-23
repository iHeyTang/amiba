import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { ComposerChainProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { UseSessionPendingInteraction } from "@deepseek-ai/dsh-client-ui-session/client";
import type { ConversationSource } from "./conversation-snapshot.js";

/** Use the controller snapshot and the official interaction election, never UI message guesses. */
export function ComposerRegion({ sessionId, source, usePendingInteraction, fallback, render }: {
  sessionId: string;
  source?: Pick<ConversationSource, "subscribe" | "getSnapshot">;
  usePendingInteraction: UseSessionPendingInteraction;
  fallback: ReactNode;
  render(owner: ComposerChainProps, fallback: ReactNode): ReactNode;
}) {
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? (() => {}), [source]);
  const read = useCallback(() => source?.getSnapshot(), [source]);
  const session = useSyncExternalStore(subscribe, read, read);
  const id = sessionId as ComposerChainProps["sessionId"];
  const pendingInteraction = usePendingInteraction(values => id ? values.get(id) : undefined);
  // A previous session's data must not elect a takeover during navigation.
  if (!session || !id || session.sessionId !== id) return <>{fallback}</>;
  return <>{render({ sessionId: id, session, pendingInteraction }, fallback)}</>;
}
