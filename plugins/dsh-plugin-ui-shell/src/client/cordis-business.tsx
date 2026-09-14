import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { ObservableSnapshot, ToolCallOwnerProps } from "@amiba/extension-sdk";
import type { ConversationSnapshot, ToolCallBlock } from "@deepseek-ai/dsh-client-runtime/client";
import type { CordisDynamicPluginId, CordisDynamicPackageId, CordisDynamicPluginRunId } from "@deepseek-ai/dsh-api-remotes/client";

/** Pinned ui-cordis owner contract; no dependency on its replacement card. */
export interface CordisBusinessOwner {
  readonly pluginId: CordisDynamicPluginId;
  readonly packageId: CordisDynamicPackageId;
  readonly pluginRunId: CordisDynamicPluginRunId;
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "tool.view.cordis": { kind: "keyed"; scope: "session"; owner: CordisBusinessOwner };
  }
}
export type CordisPackages = ObservableSnapshot<readonly CordisBusinessOwner[]>;

function identity(block: ToolCallBlock): CordisBusinessOwner | undefined {
  if (!("kind" in block) || block.isError || block.call?.name !== "cordis_run") return;
  const meta = block.meta as Partial<CordisBusinessOwner> | null | undefined;
  if (!meta || typeof meta.pluginId !== "string" || typeof meta.packageId !== "string" || typeof meta.pluginRunId !== "string") return;
  return { pluginId: meta.pluginId, packageId: meta.packageId, pluginRunId: meta.pluginRunId };
}

/** One latest successful card per Package, and only the exact activation loaded here. */
export function cordisBusinessOwner(block: ToolCallBlock, snapshot: Pick<ConversationSnapshot, "nodes"> | undefined,
  loaded: readonly CordisBusinessOwner[]): CordisBusinessOwner | undefined {
  const owner = identity(block);
  if (!owner || !("kind" in block) || !snapshot || !loaded.some(row => row.pluginId === owner.pluginId &&
    row.packageId === owner.packageId && row.pluginRunId === owner.pluginRunId)) return;
  let latest: ToolCallBlock | undefined;
  const visit = (candidate: ToolCallBlock) => {
    const next = identity(candidate);
    if (next?.pluginId === owner.pluginId && next.packageId === owner.packageId && "kind" in candidate &&
        (!latest || !("kind" in latest) || candidate.seq > latest.seq)) latest = candidate;
    for (const child of candidate.subCalls) visit(child);
  };
  for (const node of snapshot.nodes) if (node.kind === "tool-result") visit(node);
  if (latest && "kind" in latest && latest.callId === block.callId && latest.seq === block.seq) return owner;
}

export function CordisBusiness({ owner, source, packages, render }: {
  owner: ToolCallOwnerProps;
  source?: ObservableSnapshot<ConversationSnapshot>;
  packages: CordisPackages;
  render(owner: CordisBusinessOwner): ReactNode;
}) {
  const subscribe = useCallback((fn: () => void) => source?.subscribe(fn) ?? (() => {}), [source]);
  const read = useCallback(() => source?.getSnapshot(), [source]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const loaded = useSyncExternalStore(packages.subscribe, packages.getSnapshot, packages.getSnapshot);
  const business = cordisBusinessOwner(owner.block, snapshot, loaded);
  return business ? <>{render(business)}</> : null;
}
