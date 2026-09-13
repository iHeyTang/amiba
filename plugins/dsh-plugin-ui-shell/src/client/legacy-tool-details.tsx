import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { ObservableSnapshot, WorkbenchPanelOwner } from "@amiba/extension-sdk";
import type { ConversationSnapshot, ToolCallBlock } from "@deepseek-ai/dsh-client-runtime/client";
import type { DetailsToolOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { WorkbenchViewBoundary } from "@amiba/ui/plugin";

export const LEGACY_TOOL_DETAILS_PANEL = "dsh-tool-details";
/** Retain the exact official slices, including nested calls, without fabricating results. */
export function legacyToolCalls(snapshot: Pick<ConversationSnapshot, "nodes" | "runningCalls"> | undefined): readonly ToolCallBlock[] {
  const calls = new Map<string, ToolCallBlock>();
  const visit = (block: ToolCallBlock) => {
    calls.set(block.callId, block);
    for (const child of block.subCalls) visit(child);
  };
  for (const node of snapshot?.nodes ?? []) if (node.kind === "tool-result") visit(node);
  for (const call of snapshot?.runningCalls ?? []) visit(call);
  return [...calls.values()];
}
function DetailBody({ owner, render }: { owner: DetailsToolOwnerProps; render: (owner: DetailsToolOwnerProps) => ReactNode }) {
  return render(owner);
}
export function LegacyToolDetails({ enabled = true, source, sessionId, cwd, panel, selectedCallId, onSelect, render, label, emptyLabel }: {
  enabled?: boolean;
  source?: ObservableSnapshot<ConversationSnapshot>;
  sessionId: string;
  cwd?: string;
  panel: WorkbenchPanelOwner;
  selectedCallId: string | null;
  onSelect(callId: string): void;
  render(owner: DetailsToolOwnerProps): ReactNode;
  label: string;
  emptyLabel: string;
}) {
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? (() => {}), [source]);
  const read = useCallback(() => source?.getSnapshot(), [source]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (!enabled && panel.placement === "tab") panel.closePanel?.(LEGACY_TOOL_DETAILS_PANEL);
  }, [enabled, panel.placement, panel.closePanel]);
  if (!enabled) return null;
  const calls = legacyToolCalls(snapshot?.sessionId === sessionId ? snapshot : undefined);
  if (panel.placement === "tab") return <button type="button" role="tab" aria-selected={panel.activePanel === LEGACY_TOOL_DETAILS_PANEL}
    className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/45 hover:text-foreground"
    onClick={() => panel.openPanel(LEGACY_TOOL_DETAILS_PANEL)}>{label}</button>;
  if (panel.activePanel !== LEGACY_TOOL_DETAILS_PANEL) return null;
  const selected = calls.find(call => call.callId === selectedCallId);
  return <section data-legacy-tool-details className="flex h-full min-h-0 flex-col gap-3 p-3">
    <select aria-label={label} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
      value={selected?.callId ?? ""} onChange={event => onSelect(event.target.value)}>
      <option value="" disabled>{emptyLabel}</option>
      {calls.map(call => <option key={call.callId} value={call.callId}>{("kind" in call ? call.call?.name : call.name) ?? call.callId} · {call.callId}</option>)}
    </select>
    <div className="min-h-0 flex-1 overflow-auto">
      {selected ? <WorkbenchViewBoundary key={`${sessionId}:${selected.callId}`} fallback={null} resetKey={render}>
        <DetailBody owner={{ block: selected, ...(cwd === undefined ? {} : { cwd }) }} render={render} />
      </WorkbenchViewBoundary> : <p role="status" className="text-xs text-muted-foreground">{emptyLabel}</p>}
    </div>
  </section>;
}
