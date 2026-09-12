import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type {
  ConversationSnapshot,
  ObservableSnapshot,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { TurnTailOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";

export function turnTailOwner(
  snapshot: ConversationSnapshot | null,
  runtimeTurn: number,
  openFile: (path: string) => void,
): TurnTailOwnerProps | null {
  const turn = snapshot?.chat.timeline.turns.get(runtimeTurn);
  if (!turn || turn.status !== "closed") return null;
  const data = turn.data.get("turn-tail");
  if (!data) return null;
  return { turn, seq: data.closing?.finalNode.seq ?? data.seq, openFile };
}

/** A session face is supplied, never its Cordis context or a copied timeline. */
export function TurnTail({
  source,
  runtimeTurn,
  openFile,
  render,
}: {
  source?: ObservableSnapshot<ConversationSnapshot>;
  runtimeTurn: number;
  openFile: (path: string) => void;
  render: (owner: TurnTailOwnerProps) => ReactNode;
}) {
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => {}),
    [source],
  );
  const getSnapshot = useCallback(
    () => source?.getSnapshot() ?? null,
    [source],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owner = turnTailOwner(snapshot, runtimeTurn, openFile);
  return owner ? render(owner) : null;
}
