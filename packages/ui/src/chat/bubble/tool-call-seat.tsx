import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * One `tool.call.toolview` dispatch request, computed by the tool row per
 * render: the official owner share plus the row the host must fall back to.
 *
 * `fallback` is the seat's whole visual-parity guarantee. It is Amiba's own
 * tool row, already built; the host hands it to `renderSlot`'s `fallback`
 * option, so a tool name no plugin registered renders EXACTLY what it
 * rendered before the seat existed, and a registered name replaces only that
 * one row.
 */
export interface ToolCallSeatRequest {
  owner: ToolCallOwnerProps;
  fallback: ReactNode;
}

/**
 * Renders one tool call row from the seat request. The host builds this from
 * the official dispatch —
 * `renderSlot("tool.call.toolview", request.owner, { entryKey:
 * request.owner.toolName, fallback: request.fallback })` — so the tool row
 * itself holds no slot knowledge.
 */
export type ToolCallSeatRenderer = (request: ToolCallSeatRequest) => ReactNode;

interface ToolCallSeat {
  render: ToolCallSeatRenderer;
  /** Session workspace root, the `cwd` member of the official owner share. */
  cwd?: string;
}

/**
 * Absent by default. Every tool row is reachable only through this context,
 * so a surface that provides nothing (Quick-Ask, any host outside a DSH
 * plugin runtime, every existing test) renders the built-in row unchanged.
 */
const ToolCallSeatContext = createContext<ToolCallSeat | null>(null);

/**
 * Publish the host's keyed tool-view dispatch to the conversation's tool
 * rows.
 *
 * A context rather than prop drilling, for the same reason `WorkspacePane`
 * uses one: the tool row sits five components below the surface
 * (MessageTurns → Bubble / InterleavedAssistantFlow /
 * TurnExecutionDisclosure → ExecutionDisclosure → ToolChip), all of which
 * are pure presentation and none of which should learn about slots to pass a
 * node through. The renderer still ARRIVES as an explicit render prop at the
 * surface boundary (`<FullScreenChatView slots.toolView>` →
 * `<ChatSurface slots.toolView>`), exactly like the composer seats; this
 * provider is only the last hop.
 *
 * @param props.render - the host's renderSlot-backed dispatch, or undefined.
 * @param props.cwd - the active conversation's workspace root, when bound.
 * @param props.children - the conversation subtree.
 * @returns the subtree, with the seat published when a renderer exists.
 */
export function ToolCallSeatProvider({
  render,
  cwd,
  children,
}: {
  render?: ToolCallSeatRenderer;
  cwd?: string | null;
  children: ReactNode;
}) {
  const value = useMemo<ToolCallSeat | null>(
    () => (render ? { render, ...(cwd ? { cwd } : {}) } : null),
    [render, cwd],
  );
  return (
    <ToolCallSeatContext.Provider value={value}>
      {children}
    </ToolCallSeatContext.Provider>
  );
}

/** The host's tool-view seat, or null on surfaces that provide none. */
export function useToolCallSeat(): ToolCallSeat | null {
  return useContext(ToolCallSeatContext);
}
