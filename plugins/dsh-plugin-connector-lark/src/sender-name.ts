/** A per-connection cache: open ids must never be shared between app identities. */
export function createSenderNameResolver(load: (openId: string) => Promise<string | undefined>) {
  const cache = new Map<string, { name?: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string | undefined>>();
  return async (openId: string): Promise<string | undefined> => {
    const cached = cache.get(openId);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    const current = pending.get(openId);
    if (current) return current;
    const request = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const name = await Promise.race([
          Promise.resolve().then(() => load(openId)).catch(() => undefined),
          new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1500); }),
        ]);
        const trimmed = name?.trim() || undefined;
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(openId, { name: trimmed, expiresAt: Date.now() + (trimmed ? 15 * 60_000 : 60_000) });
        return trimmed;
      } finally {
        if (timer) clearTimeout(timer);
        pending.delete(openId);
      }
    })();
    pending.set(openId, request);
    return request;
  };
}
