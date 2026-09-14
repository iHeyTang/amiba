interface Request {
  revisit: boolean;
  done(): void;
}
export function createLauncher() {
  let request: Request | null = null;
  let deferred = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    getSnapshot: () => request,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    open(next: Request) {
      if (!next.revisit && deferred) {
        next.done();
        return () => {};
      }
      if (request) return () => {};
      request = next;
      notify();
      return () => {
        if (request === next) {
          request = null;
          notify();
        }
      };
    },
    close() {
      const previous = request;
      if (previous && !previous.revisit) deferred = true;
      request = null;
      notify();
      previous?.done();
    },
  };
}
export type Launcher = ReturnType<typeof createLauncher>;
