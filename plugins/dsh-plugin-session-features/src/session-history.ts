import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import type { SessionId } from "@deepseek-ai/dsh-session";

/** Read a stable stored prefix and always release its independent read handle. */
export async function readSessionHistory(persistence: SessionPersistence, id: string, fromSeq = 0) {
  const handle = await persistence.open(id as SessionId, "read");
  try {
    const result = await handle.read(fromSeq);
    return { meta: handle.header, events: result.events };
  } finally { await handle.close(); }
}
