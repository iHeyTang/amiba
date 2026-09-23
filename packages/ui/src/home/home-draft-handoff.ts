// Same-renderer receivers must not overwrite the draft while Home is consuming
// it. Other windows own independent in-memory sources and need no such wait.
const pending = new Map<string, Promise<void>>();
export function beginHomeDraftHandoff(sessionId: string): () => void {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  pending.set(sessionId, promise);
  return () => { if (pending.get(sessionId) === promise) pending.delete(sessionId); release(); };
}
export async function waitForHomeDraftHandoff(sessionId?: string): Promise<void> {
  if (sessionId) await pending.get(sessionId);
}
