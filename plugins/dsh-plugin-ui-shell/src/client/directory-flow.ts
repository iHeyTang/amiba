import type { DirectoryFlowOwnerProps } from "@amiba/extension-sdk";

export interface DirectoryFlowSnapshot {
  available: boolean;
  owner: DirectoryFlowOwnerProps;
}
interface Slots {
  entriesOfSlot(name: string): readonly unknown[];
  subscribe(name: string, listener: () => void): () => void;
}
interface Request {
  entry: unknown;
  busy: boolean;
  resolve(path: string | null): void;
  reject(error: Error): void;
}
export function createDirectoryFlow(
  slots: Slots,
  name: string,
  adopt: (path: string) => Promise<unknown>,
) {
  let current: Request | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot = read();
  function read(): DirectoryFlowSnapshot {
    const request = current;
    return {
      available: !disposed && slots.entriesOfSlot(name).length > 0,
      owner: {
        open: request !== undefined,
        busy: request?.busy ?? false,
        onCancel: () => finish(request, null),
        onError: (message) => finish(request, new Error(message)),
        onPicked: (path) => {
          if (!request || request !== current || request.busy) return;
          request.busy = true;
          publish();
          void Promise.resolve().then(async () => {
            // Cancellation/unload before the microtask must not start adoption.
            if (request !== current) return;
            try {
              await adopt(path);
              finish(request, path);
            } catch (error) {
              finish(
                request,
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          });
        },
      },
    };
  }
  function publish() {
    snapshot = read();
    for (const listener of listeners) listener();
  }
  function finish(request: Request | undefined, result: string | null | Error) {
    if (!request || request !== current) return;
    current = undefined;
    publish();
    if (result instanceof Error) request.reject(result);
    else request.resolve(result);
  }
  const unsubscribe = slots.subscribe(name, () => {
    if (current && slots.entriesOfSlot(name)[0] !== current.entry)
      finish(current, null);
    else publish();
  });
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    choose(
      defaultPath?: string,
      fallback?: (defaultPath?: string) => Promise<string | null>,
    ): Promise<string | null> {
      if (disposed) return Promise.resolve(null);
      finish(current, null);
      const entry = slots.entriesOfSlot(name)[0];
      // No occupant: preserve the platform chooser, including its starting path.
      if (!entry) return fallback?.(defaultPath) ?? Promise.resolve(null);
      return new Promise((resolve, reject) => {
        current = { entry, busy: false, resolve, reject };
        publish();
      });
    },
    dispose() {
      disposed = true;
      finish(current, null);
      unsubscribe();
      listeners.clear();
      snapshot = read();
    },
  };
}
export type DirectoryFlow = ReturnType<typeof createDirectoryFlow>;
