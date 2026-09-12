import { WorkspaceTextMentionsContext } from "@amiba/ui";
import type { ChatFileMentions } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  const snapshot = useConversationSnapshot(source);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRequest = useRef(0);
  useEffect(() => {
    fileRequest.current += 1;
    setFileError(null);
    return () => { fileRequest.current += 1; };
  }, [source, runtimeTurn]);
  const requestOpenFile = useCallback((path: string) => {
    const request = ++fileRequest.current;
    Promise.resolve().then(() => openFile(path)).then(() => {
      if (request === fileRequest.current) setFileError(null);
    }, error => {
      if (request === fileRequest.current) setFileError(error instanceof Error ? error.message : String(error));
    });
  }, [openFile]);
  const owner = turnTailOwner(snapshot, runtimeTurn, requestOpenFile);
  return owner ? <>{render(owner)}{fileError ? <p role="alert" className="text-xs text-destructive">{fileError}</p> : null}</> : null;
}

function useConversationSnapshot(source?: ObservableSnapshot<ConversationSnapshot>) {
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => {}),
    [source],
  );
  const getSnapshot = useCallback(
    () => source?.getSnapshot() ?? null,
    [source],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Preserve engine order even when the product has no visible assistant row. */
export function useTurnTailAnchors(source?: ObservableSnapshot<ConversationSnapshot>) {
  const snapshot = useConversationSnapshot(source);
  return useMemo(() => snapshot?.chat.timeline.turnOrder.flatMap(runtimeTurn => {
    const turn = snapshot.chat.timeline.turns.get(runtimeTurn);
    return turn?.status === "closed" && turn.end && turn.data.get("turn-tail")
      ? [{ runtimeTurn, endSeq: turn.end.seq }] : [];
  }) ?? [], [snapshot]);
}


/** The native Markdown renderer supplies the exact source sequence of each code span. */
export function TurnText({source,runtimeTurn,openFile,fileMentions,children}:{
  source?:ObservableSnapshot<ConversationSnapshot>;
  runtimeTurn?:number;
  openFile:(path:string)=>void;
  fileMentions:ChatFileMentions["forClosing"];
  children:ReactNode;
}) {
  const snapshot=useConversationSnapshot(source);
  const owner=runtimeTurn===undefined?null:turnTailOwner(snapshot,runtimeTurn,openFile);
  const mentions=owner?fileMentions(owner):undefined;
  return <WorkspaceTextMentionsContext.Provider value={(seq,value)=>owner?.seq===seq?mentions?.resolve(value):undefined}>{children}</WorkspaceTextMentionsContext.Provider>;
}
