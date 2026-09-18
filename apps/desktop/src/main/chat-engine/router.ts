/**
 * Pure subscription/routing ledger for the hosted chat engine.
 *
 * `ChatEngineHost` wires this to Electron (webContents ids, `chat-engine:*`
 * IPC); this module has no Electron dependency so the window-subscription
 * semantics (first viewer opens the journal follow, last viewer releases it,
 * per-session routing and draft-submitter accounting) are unit-testable in
 * isolation.
 */

import type { AgentSubagentAddress } from "@amiba/app-runtime/platform";
import type { EngineToClientMessage } from "@amiba/app-runtime/protocol";

export class ChatEngineRouter {
  private readonly subscribers = new Map<string, Set<number>>();
  private readonly addresses = new Map<string, AgentSubagentAddress>();
  private readonly submitters = new Map<string, number>();

  /**
   * Register a window's interest in a session. Returns true when this is the
   * FIRST viewer of the session (the host must open its journal follow).
   */
  subscribe(
    webContentsId: number,
    sessionId: string,
    subagent?: AgentSubagentAddress,
  ): boolean {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    const first = set.size === 0;
    set.add(webContentsId);
    if (subagent) this.addresses.set(sessionId, subagent);
    return first;
  }

  /**
   * Remove a window's interest. Returns true when the LAST viewer left (the
   * host must release the journal follow).
   */
  unsubscribe(webContentsId: number, sessionId: string): boolean {
    const set = this.subscribers.get(sessionId);
    if (!set) return false;
    set.delete(webContentsId);
    this.addresses.delete(sessionId);
    if (set.size > 0) return false;
    this.subscribers.delete(sessionId);
    this.submitters.delete(sessionId);
    return true;
  }

  hasSubscribers(sessionId: string): boolean {
    return (this.subscribers.get(sessionId)?.size ?? 0) > 0;
  }

  address(sessionId: string): AgentSubagentAddress | undefined {
    return this.addresses.get(sessionId);
  }

  /** Record which window last submitted a turn of this session. */
  declareSubmitter(sessionId: string, webContentsId: number): void {
    this.submitters.set(sessionId, webContentsId);
  }

  /** The window that last submitted this session's turn (draft owner). */
  submitter(sessionId: string): number | undefined {
    return this.submitters.get(sessionId);
  }

  /** Deliver one engine message to every viewer of the session. */
  route(
    sessionId: string,
    message: EngineToClientMessage,
    deliver: (webContentsId: number, message: EngineToClientMessage) => void,
  ): void {
    const set = this.subscribers.get(sessionId);
    if (!set) return;
    for (const id of set) deliver(id, message);
  }

  clear(): void {
    this.subscribers.clear();
    this.addresses.clear();
    this.submitters.clear();
  }
}