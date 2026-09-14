import type { ToolCallBlock, ToolCallOwnerProps } from "@amiba/extension-sdk";
import { useT } from "@amiba/i18n";
import { Wrench } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CodeEvidence, EvidenceShell, StructuredEvidence } from "./tool-evidence";
import { toolCallArgs, toolCallBlockName, toolCallDurationMs, toolCallFailed, toolCallResultText, toolCallSettled } from "./tool-call-block";
import { useToolCallSeat, type ToolCallSeatRenderer } from "./tool-call-seat";
import { useToolImageEvidence } from "./tool-image-evidence";
import { WorkbenchViewBoundary } from "../workbench-extensions";
import { ToolRowFrame } from "./tool-row-frame";

const ManagedTree = createContext(false);
const empty = { callId: "", version: 0 };
const getEmpty = () => empty;
const subscribeEmpty = () => () => {};

export function toolCallTreeContains(block: ToolCallBlock, callId: string): boolean {
  return block.callId === callId || block.subCalls.some(child => toolCallTreeContains(child, callId));
}

/** Expand the existing root evidence fold before revealing one of its descendants. */
export function useNestedToolExpansion(block: ToolCallBlock | null) {
  const managed = useContext(ManagedTree);
  const navigation = useToolCallSeat()?.navigation;
  const request = useSyncExternalStore(navigation?.subscribe ?? subscribeEmpty, navigation?.getSnapshot ?? getEmpty);
  const [expanded, setExpanded] = useState(false);
  const handled = useRef(0);
  useEffect(() => {
    if (!managed && request.version !== handled.current && block?.subCalls.some(child => toolCallTreeContains(child, request.callId))) {
      handled.current = request.version;
      setExpanded(true);
    }
  }, [request, block, managed]);
  return { expanded, onExpandedChange: setExpanded };
}

/** Honest generic fallback from a canonical block: no invented turn, step or start time. */
function NestedFallback({ owner }: { owner: ToolCallOwnerProps }) {
  const { t } = useT();
  const settled = toolCallSettled(owner.block);
  const images = useToolImageEvidence(owner.callId, owner.block);
  const text = toolCallResultText(owner.block);
  return <ToolRowFrame icon={Wrench} action={t("sidepanel.trace.actions.useTool")}
    target={owner.toolName || undefined} ariaLabel={owner.toolName || owner.callId}
    running={!settled} failed={toolCallFailed(owner.block)} durationMs={toolCallDurationMs(owner.block)}
    detail={settled ? <EvidenceShell tag="generic">
      {text ? <CodeEvidence text={text} tone={settled.isError ? "error" : "default"} /> : <StructuredEvidence value={settled.content.length ? settled.content : toolCallArgs(owner.block)} />}
      {images}
    </EvidenceShell> : undefined} />;
}

function AtomicNestedView({ owner, render }: { owner: ToolCallOwnerProps; render: ToolCallSeatRenderer }) {
  return <>{render({ owner, fallback: <NestedFallback owner={owner} /> })}</>;
}

function NestedBranch({ parent, block, render }: { parent: ToolCallOwnerProps; block: ToolCallBlock; render: ToolCallSeatRenderer }) {
  const navigation = useToolCallSeat()?.navigation;
  const request = useSyncExternalStore(navigation?.subscribe ?? subscribeEmpty, navigation?.getSnapshot ?? getEmpty);
  const ref = useRef<HTMLDivElement>(null);
  const revealVersion = request.callId === block.callId ? request.version : 0;
  useEffect(() => { if (revealVersion) ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [revealVersion]);
  const owner: ToolCallOwnerProps = {
    ...parent, block, callId: block.callId, toolName: toolCallBlockName(block),
    presentation: "row", inspect: undefined, revealVersion,
  };
  return <div ref={ref}>
    <WorkbenchViewBoundary resetKey={render} fallback={<NestedFallback owner={owner} />}><AtomicNestedView owner={owner} render={render} /></WorkbenchViewBoundary>
    {block.subCalls.length > 0 ? <div className="ml-[7px] border-l border-border/60 pl-4">
      {block.subCalls.map(child => <NestedBranch key={child.callId} parent={owner} block={child} render={render} />)}
    </div> : null}
  </div>;
}

/** The outer native evidence owns recursion; a contributed child row owns only its atomic view. */
export function useNestedToolCalls(owner: ToolCallOwnerProps | undefined) {
  const managed = useContext(ManagedTree);
  const render = useToolCallSeat()?.render;
  if (managed || !render || !owner || owner.presentation === "summary" || !owner.block.subCalls.length) return null;
  return <ManagedTree.Provider value={true}>
    <div className="flex min-w-0 flex-col gap-0.5">
      {owner.block.subCalls.map(block => <NestedBranch key={block.callId} parent={owner} block={block} render={render} />)}
    </div>
  </ManagedTree.Provider>;
}
