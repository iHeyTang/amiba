import { getPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

// Window-local ownership: another window must never reuse this window's draft.
const drafts = new WeakMap<PlatformAdapter, Map<string, { id?: string; pending?: Promise<string> }>>();
export async function prepareHomeSession(cwd: string, profileId?: string, inheritModelFrom?: string): Promise<string> {
  const platform = getPlatform();
  const sessions = platform.agentSessions;
  if (!sessions) throw new Error("Session service is unavailable");
  let rows = drafts.get(platform);
  if (!rows) drafts.set(platform, rows = new Map());
  let draft = rows.get(cwd);
  if (!draft) rows.set(cwd, draft = {});
  // Serialize preparation (including preset switches) across StrictMode effects.
  const previous = draft.pending;
  const entry = draft;
  const pending = (async () => {
    await previous?.catch(() => undefined);
    const existing = entry.id ? (await sessions.list()).find(row => row.sessionId === entry.id) : undefined;
    if (!existing?.blank || existing.running) {
      entry.id = (await sessions.create({ cwd, agentPreset: profileId })).sessionId;
    } else if (profileId && existing.agentPreset !== profileId) {
      if (!platform.agentPresets) throw new Error("Agent preset service is unavailable");
      await platform.agentPresets.select(existing.sessionId, profileId);
    }
    if (inheritModelFrom && inheritModelFrom !== entry.id && platform.agentModels) {
      const directory = await platform.agentModels.directory(inheritModelFrom);
      if (directory?.routable) await platform.agentModels.select(entry.id!, directory.current);
    }
    if (platform.workspaces) await platform.workspaces.bind(entry.id!, cwd);
    return entry.id!;
  })();
  entry.pending = pending;
  try { return await pending; }
  finally { if (entry.pending === pending) entry.pending = undefined; }
}

/** Once handed off, the draft belongs to its receiving conversation window. */
export function consumeHomeSession(id: string): void {
  for (const [cwd, entry] of drafts.get(getPlatform()) ?? []) {
    if (entry.id === id) drafts.get(getPlatform())!.delete(cwd);
  }
}
