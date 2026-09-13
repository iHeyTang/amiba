import type { IpcMain, WebContents } from 'electron';

/** Resource observations are owned by the originating document, not just its
 * process. Reload/navigation closes them even if renderer cleanup never runs.
 */
export function registerFileResourceIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  rootForSession: (sessionId: string) => string | null,
  observeWorkspaceFile: typeof import('./workspace-file-observer').observeWorkspaceFile,
  onWorkspaceChange: (changed: (event: { sessionId: string }) => void) => () => void = () => () => {},
) {
  const owners = new Map<number, {
    subscriptions: Map<string, AbortController>;
    release(): void;
  }>();
  function ownerFor(sender: WebContents) {
    const existing = owners.get(sender.id);
    if (existing) return existing;
    const subscriptions = new Map<string, AbortController>();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const controller of subscriptions.values()) controller.abort();
      subscriptions.clear();
      owners.delete(sender.id);
      sender.removeListener('destroyed', release);
      sender.removeListener('did-start-navigation', navigating);
    };
    const navigating = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) release();
    };
    const owner = { subscriptions, release };
    owners.set(sender.id, owner);
    sender.once('destroyed', release);
    sender.on('did-start-navigation', navigating);
    return owner;
  }

  ipcMain.handle('files:observe-resource', async (event, args: { id: string; sessionId: string; path: string }) => {
    if (!args.id || !args.sessionId || typeof args.path !== 'string') throw new Error('Invalid resource observation.');
    if (event.sender.isDestroyed()) return;
    const owner = ownerFor(event.sender);
    if (owner.subscriptions.has(args.id)) throw new Error('Duplicate resource observation.');
    const controller = new AbortController();
    owner.subscriptions.set(args.id, controller);
    let current: AbortController | undefined;
    let setup: Promise<void>;
    const notify = () => {
      if (!controller.signal.aborted && !event.sender.isDestroyed()) {
        event.sender.send('files:resource-changed', args.id);
      }
    };
    const begin = (): Promise<void> => {
      current?.abort();
      const generation = new AbortController();
      current = generation;
      const pending = (async () => {
        const root = rootForSession(args.sessionId);
        if (!root) throw new Error('No workspace is bound to this conversation.');
        await observeWorkspaceFile(root, args.path, () => {
          if (current === generation && !generation.signal.aborted) notify();
        }, generation.signal);
      })();
      // Later rebind failures invalidate metadata but keep the workspace change
      // subscription, so a subsequent valid binding can establish observation.
      void pending.catch(() => {
        if (current === generation && !generation.signal.aborted) notify();
      });
      return pending;
    };
    const offWorkspace = onWorkspaceChange(change => {
      if (change.sessionId !== args.sessionId || controller.signal.aborted) return;
      setup = begin();
      notify();
    });
    const stop = () => { current?.abort(); offWorkspace(); };
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      setup = begin();
      // Binding may change while initial native discovery is in flight. Only
      // the latest generation's completion can resolve the caller's readiness.
      for (;;) {
        const pending = setup;
        try { await pending; } catch (error) {
          if (pending === setup) throw error;
        }
        if (pending === setup || controller.signal.aborted) break;
      }
    } catch (error) {
      controller.abort();
      owner.subscriptions.delete(args.id);
      if (!owner.subscriptions.size) owner.release();
      throw error;
    }
  });
  ipcMain.handle('files:unobserve-resource', (event, id: string) => {
    const owner = owners.get(event.sender.id);
    owner?.subscriptions.get(id)?.abort();
    owner?.subscriptions.delete(id);
    if (owner && !owner.subscriptions.size) owner.release();
  });
}
