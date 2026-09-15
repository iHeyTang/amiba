import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { PetLibrary, PetInput } from "../model.js";
import type {} from "../remote.js";
export function createPetLibrary(remote: ClientContext["remote"]["amibaPets"]) {
  let state: { library: PetLibrary; error: string | null; loading: boolean } = {
    library: { version: 1, activeId: null, pets: [] },
    error: null,
    loading: true,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let pending: Promise<void> | undefined;
  const emit = () => {
    if (!disposed) listeners.forEach((fn) => fn());
  };
  const value = async <T>(
    promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
  ): Promise<T> => {
    const result = await promise;
    if (!result.ok)
      throw new Error(
        typeof result.error === "object" &&
        result.error &&
        "message" in result.error
          ? String(result.error.message)
          : String(result.error),
      );
    return result.value;
  };
  const accept = (library: PetLibrary) => {
    if (
      JSON.stringify(library) !== JSON.stringify(state.library) ||
      state.loading ||
      state.error
    ) {
      state = { library, loading: false, error: null };
      emit();
    }
  };
  const refresh = () =>
    (pending ??= value(remote.list())
      .then(accept)
      .catch((e) => {
        state = { ...state, error: String(e), loading: false };
        emit();
      })
      .finally(() => {
        pending = undefined;
      }));
  const mutate = async (
    p: Promise<{ ok: true; value: PetLibrary } | { ok: false; error: unknown }>,
  ) => {
    const library = await value(p);
    await pending;
    accept(library);
    return library;
  };
  // One shared poll per plugin, never one poll per pet surface. Agent writes become visible.
  const timer = setInterval(() => {
    if (!document.hidden) void refresh();
  }, 2000);
  void refresh();
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh,
    save: (input: PetInput) => mutate(remote.save(input)),
    activate: (id: string | null) => mutate(remote.activate(id)),
    remove: (id: string) => mutate(remote.deletePet(id)),
    studio: () => value(remote.studio()),
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
export type PetLibraryClient = ReturnType<typeof createPetLibrary>;
