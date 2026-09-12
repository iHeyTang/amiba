import type { Context } from "@deepseek-ai/cordis";
import type { TypertLookupRegistry } from "@deepseek-ai/dsh-typert-protocol";

/** Resume only the persisted direct parent, through the Host's configured policy. */
export async function prepareSubagentParent(host: Context, sessionId: string): Promise<void> {
  // Keep Host-only Context augmentations out of this package's shared Client
  // type graph; these are the public persistence/lookup service faces.
  const persistence = host.reflect.get("sessionPersistence") as {
    list(): Promise<readonly { id: string; origin?: string }[]>;
    inspect(id: string): Promise<{
      meta: { origin?: string; parentSession?: string; seedLength?: number };
      events: readonly { type: string; data: unknown }[];
    }>;
  } | undefined;
  if (!persistence) return;
  const header = (await persistence.list()).find(item => item.id === sessionId);
  // New ordinary sessions and unrelated root sessions keep the original path.
  if (header?.origin !== "subagent") return;
  const stored = await persistence.inspect(sessionId);
  const parentId = stored.meta.parentSession;
  if (stored.meta.origin !== "subagent" || !parentId) return;
  if (parentId === sessionId) throw new Error("Invalid subagent parent identity");
  // Ignore ancestor descriptors inherited through a fork seed. Actual followup
  // still folds and validates the full descriptor through official subagent routing.
  const descriptor = stored.events.slice(stored.meta.seedLength ?? 0)
    .findLast(event => event.type === "subagent/descriptor")?.data as { version?: number; mode?: string } | undefined;
  if (descriptor?.version !== 2 || descriptor.mode !== "continuable") return;
  const agents = host.reflect.get("agents") as { get(id: string): unknown } | undefined;
  if (agents?.get(parentId)) return;
  const typert = host.reflect.get("typert") as { lookups: TypertLookupRegistry } | undefined;
  const lookup = typert?.lookups.get("agent");
  if (!lookup || !await lookup.resolve(parentId)) throw new Error("Subagent parent recovery is unavailable");
}
