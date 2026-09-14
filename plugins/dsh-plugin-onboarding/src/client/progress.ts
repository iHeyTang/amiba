import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
export interface Progress {
  completed: string[];
  skipped?: string[];
  finished: boolean;
}
export interface ProgressStore {
  read(): Promise<Progress>;
  mark(id: string, skipped?: boolean): Promise<Progress>;
  finish(): Promise<Progress>;
}
async function value<T>(
  response: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>,
): Promise<T> {
  const result = await response;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function createProgressStore(api: ClientRemote): ProgressStore {
  async function describe() {
    const result = await value(api.settings.describe());
    const ns = result.namespaces.find((n) => n.ns === "amiba-onboarding");
    if (!ns) throw new Error("Onboarding settings unavailable");
    const data = ns.value as Partial<Progress>;
    return {
      ns,
      writable: result.writable,
      progress: {
        completed: Array.isArray(data.completed)
          ? data.completed.filter((id): id is string => typeof id === "string")
          : [],
        skipped: Array.isArray(data.skipped)
          ? data.skipped.filter((id): id is string => typeof id === "string")
          : [],
        finished: data.finished === true,
      },
    };
  }
  let queue: Promise<unknown> = Promise.resolve();
  function update(id?: string, skip = false): Promise<Progress> {
    const next = queue.then(async () => {
      const { ns, writable, progress } = await describe();
      if (!writable) throw new Error("Onboarding settings are read-only");
      const completed = id
        ? [...new Set([...progress.completed, id])]
        : progress.completed;
      const skipped = id
        ? [
            ...new Set([
              ...(progress.skipped ?? []).filter((value) => value !== id),
              ...(skip ? [id] : []),
            ]),
          ]
        : (progress.skipped ?? []);
      await value(
        api.settings.mutate(ns.ns, id
            ? [
                { op: "set", path: ["completed"], value: completed },
                { op: "set", path: ["skipped"], value: skipped },
              ]
            : [{ op: "set", path: ["finished"], value: true }], ns.revision),
      );
      return { completed, skipped, finished: id ? progress.finished : true };
    });
    queue = next.catch(() => {});
    return next;
  }
  return {
    read: async () => (await describe()).progress,
    mark: (id, skipped) => update(id, skipped),
    finish: () => update(),
  };
}
