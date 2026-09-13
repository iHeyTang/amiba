import type { IpcMain, WebContents } from 'electron';

/** Resource observations are owned by the originating document, not just its
 * process. Reload/navigation closes them even if renderer cleanup never runs.
 */
export function registerFileResourceIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  rootForSession: (sessionId: string) => string | null,
  observeWorkspaceFile: typeof import('./workspace-file-observer').observeWorkspaceFile,
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
    try {
      const root = rootForSession(args.sessionId);
      if (!root) throw new Error('No workspace is bound to this conversation.');
      await observeWorkspaceFile(root, args.path, () => {
        if (!controller.signal.aborted && !event.sender.isDestroyed()) {
          event.sender.send('files:resource-changed', args.id);
        }
      }, controller.signal);
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
