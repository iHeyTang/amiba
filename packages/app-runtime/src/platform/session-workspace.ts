/**
 * Shared session workspace + subagent-address policy.
 *
 * These strategies were historically implemented twice — once against the
 * renderer platform adapter (`resolveSessionCreationWorkspace` in
 * `platform/index.ts`) and again against main-process surfaces (the hosted
 * chat engine). Extracting them with an explicit surface interface gives
 * both sides ONE implementation: the desktop adapters and the main process
 * both call the same pure functions with their own bindings.
 */

import type { AgentSubagentAddress } from "./index.js";

/** The minimum surfaces the workspace policy needs, renderer or main. */
export interface SessionWorkspaceSurfaces {
  listBindings(): Record<string, string> | Promise<Record<string, string>>;
  listSessions(): Promise<Array<{ sessionId: string; cwd?: string }>>;
  bindIfUnbound?(
    sessionId: string,
    cwd: string,
  ): Promise<string | null | undefined>;
  resolveRuntimeCwd?(
    sessionId: string,
    cwd: string,
  ): Promise<string | undefined>;
  getDefaultRoot?(): Promise<string | undefined>;
  createWorkspace?(
    cwd: string,
  ): Promise<{ workspace: { workspaceId: string } }>;
}

/** Session.create directory policy — see `resolveSessionCreationWorkspace`. */
export async function ensureSessionWorkspaceWith(
  sessionId: string,
  surfaces: SessionWorkspaceSurfaces,
): Promise<string | undefined> {
  const bindings = await surfaces.listBindings();
  const bound = bindings[sessionId];
  if (bound) return bound;
  const existing = (await surfaces.listSessions()).find(
    (session) => session.sessionId === sessionId,
  );
  if (existing?.cwd && surfaces.bindIfUnbound) {
    return (await surfaces.bindIfUnbound(sessionId, existing.cwd)) ?? undefined;
  }
  return surfaces.getDefaultRoot ? await surfaces.getDefaultRoot() : undefined;
}

/** Shared session.create directory policy for every surface. */
export async function resolveSessionCreationWorkspaceWith(
  sessionId: string,
  surfaces: SessionWorkspaceSurfaces,
): Promise<{ cwd?: string; workspaceId?: string }> {
  const cwd = await ensureSessionWorkspaceWith(sessionId, surfaces);
  if (!cwd) return {};
  const existing = (await surfaces.listSessions()).find(
    (session) => session.sessionId === sessionId,
  );
  if (existing?.cwd && surfaces.resolveRuntimeCwd) {
    return { cwd: await surfaces.resolveRuntimeCwd(sessionId, existing.cwd) };
  }
  const explicitlyBound = Object.hasOwn(await surfaces.listBindings(), sessionId);
  if (explicitlyBound && surfaces.createWorkspace) {
    try {
      const { workspace } = await surfaces.createWorkspace(cwd);
      return { workspaceId: workspace.workspaceId };
    } catch {
      // Workspace creation can fail transiently; fall back to the cwd.
    }
  }
  return { cwd };
}

/**
 * Retained-address validation shared by the renderer sessions runtime and the
 * main-process chat engine host. Persisted addresses are hints, never
 * authority to resume a root Agent.
 */
export function retainedAddress(
  sessionId: string,
  value: unknown,
): AgentSubagentAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const address = value as Partial<AgentSubagentAddress>;
  if (
    address.childSessionId !== sessionId ||
    typeof address.parentSessionId !== "string" ||
    !address.parentSessionId ||
    address.parentSessionId === sessionId ||
    (address.mode !== "one-shot" && address.mode !== "continuable")
  ) {
    return undefined;
  }
  return {
    parentSessionId: address.parentSessionId,
    childSessionId: sessionId,
    mode: address.mode,
  };
}