import type { AssistantTimelineItem } from "@amiba/app-runtime/protocol";
import { WorkspaceTextMentionsContext } from "@amiba/ui";
import type { ChatFileMentions } from "@deepseek-ai/dsh-client-ui-chat/client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ConversationSnapshot } from "./conversation-snapshot.js";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { TurnTailOwnerProps } from "@deepseek-ai/dsh-client-ui-chat/client";

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
  source?: ObservableSnapshot<ConversationSnapshot | undefined>;
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

function useConversationSnapshot(source?: ObservableSnapshot<ConversationSnapshot | undefined>) {
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
export function turnTailAnchorsOf(
  snapshot: ConversationSnapshot | null | undefined,
): readonly { runtimeTurn: number; endSeq: number }[] {
  return snapshot?.chat.timeline.turnOrder.flatMap(runtimeTurn => {
    const turn = snapshot.chat.timeline.turns.get(runtimeTurn);
    return turn?.status === "closed" && turn.end && turn.data.get("turn-tail")
      ? [{ runtimeTurn, endSeq: turn.end.seq }] : [];
  }) ?? [];
}

export function useTurnTailAnchors(source?: ObservableSnapshot<ConversationSnapshot | undefined>) {
  const snapshot = useConversationSnapshot(source);
  return useMemo(() => turnTailAnchorsOf(snapshot), [snapshot]);
}


/** The native Markdown renderer supplies the exact source sequence of each code span. */
export function TurnText({source,runtimeTurn,openFile,fileMentions,children,timeline}:{
  source?:ObservableSnapshot<ConversationSnapshot | undefined>;
  runtimeTurn?:number;
  openFile:(path:string)=>void;
  fileMentions:ChatFileMentions["forClosing"];
  children:ReactNode;
  timeline?:readonly AssistantTimelineItem[];
}) {
  const snapshot=useConversationSnapshot(source);
  const owner=runtimeTurn===undefined?null:turnTailOwner(snapshot,runtimeTurn,openFile);
  const mentions=owner && snapshot ? fileMentions(owner, snapshot.sessionId) : undefined;
  const interruptedStep = matchingInterruptedStep(owner, timeline);
  return <WorkspaceTextMentionsContext.Provider value={(seq,value,step)=>{
    if (!owner || !(seq!==undefined ? owner.seq===seq : step!==undefined && step===interruptedStep)) return undefined;
    const mention = mentions?.resolve(value);
    // DSH resolves an unambiguous basename to its recorded path in title.
    // Its default present-file callback launches a native app. Use the same
    // Amiba opener as the turn-tail cards, preserving official path matching.
    return mention ? { ...mention, open: () => openFile(mention.title) } : undefined;
  }}>{children}</WorkspaceTextMentionsContext.Provider>;
}

/** Authorize pending text only against the official synthetic final's complete text. */
export function matchingInterruptedStep(owner:TurnTailOwnerProps|null, timeline:readonly AssistantTimelineItem[] = []):number|undefined {
  const final = owner?.turn.data.get("turn-tail")?.closing?.finalNode;
  if (!final || final.messageId !== undefined || final.interrupted !== true) return undefined;
  const expected = final.blocks.filter(block=>block.kind === "text").map(block=>block.text).join("");
  const actual = timeline.flatMap(item=>item.kind !== "text" ? [] : (item.sourceRanges??[])
    .filter(range=>range.runtimeStep === final.step && range.runtimeSeq === undefined)
    .map(range=>item.text.slice(range.start,range.end))).join("");
  return expected && actual === expected ? final.step : undefined;
}
