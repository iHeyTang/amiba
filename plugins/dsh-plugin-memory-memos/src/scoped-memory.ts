import type { Context } from "@deepseek-ai/cordis";

/** MemOS currently has one owner-wide profile. Entry-owned backgrounds must
 * never enter that profile or receive its automatic recall. The steward
 * publishes a synchronous boundary; no memory-to-steward package dependency. */
export function hasScopedMemory(
  ctx: Context,
  session:
    | { id?: unknown; events?: readonly { type: string; data?: unknown }[] }
    | undefined,
): boolean {
  if (!session) return false;
  if (
    session.events?.some(
      (event) =>
        event.type === "amiba/session-feature" &&
        (event.data as { plugin?: string })?.plugin === "amiba-steward",
    )
  )
    return true;
  const boundary = ctx.reflect.get("amibaScopedMemory") as
    | { ownsSession(id: string): boolean }
    | undefined;
  return !!session.id && (boundary?.ownsSession(String(session.id)) ?? false);
}

/** Adapt only the upstream hook boundary. Core, storage and ordinary-chat
 * behavior remain owned by MemOS; no global recall/capture setting is changed. */
export function scopedMemoryContext(ctx: Context): Context {
  return new Proxy(ctx, {
    get(target, key) {
      if (key !== "on") return Reflect.get(target, key, target);
      return (
        name: string,
        callback: (...args: any[]) => unknown,
        ...options: unknown[]
      ) => {
        const filtered = (...args: any[]) => {
          if (
            name === "agent/pre-step" &&
            hasScopedMemory(ctx, args[0]?.agent?.session)
          )
            return args[1]();
          if (
            (name === "session/event" || name === "session/disposed") &&
            hasScopedMemory(ctx, args[0])
          )
            return;
          return callback(...args);
        };
        return (target.on as (...args: any[]) => unknown)(
          name,
          filtered,
          ...options,
        );
      };
    },
  });
}
