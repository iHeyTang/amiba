import type { IpcMain, WebContents } from 'electron';
import type { WorkspaceFileEvent } from './workspace-file-observer';

/** Both preview APIs observe only requested files. Document ownership closes
 * subscriptions on navigation/destruction, including setup still in flight.
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
      if (owners.get(sender.id) === owner) owners.delete(sender.id);
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

  async function observe(sender: WebContents, id: string, sessionId: string, paths: string[], legacy = false) {
    if (!id || !sessionId || !Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !p.trim())) {
      throw new Error('Invalid resource observation.');
    }
    if (sender.isDestroyed()) return;
    const key = `${legacy ? 'watch' : 'resource'}:${id}`;
    const owner = ownerFor(sender);
    if (owner.subscriptions.has(key)) throw new Error('Duplicate resource observation.');
    const controller = new AbortController();
    owner.subscriptions.set(key, controller);
    let current: AbortController | undefined;
    let setup: Promise<void>;
    const notify = (event: WorkspaceFileEvent = 'change', path = paths[0] ?? '') => {
      if (controller.signal.aborted || sender.isDestroyed()) return;
      if (legacy) sender.send('files:changed', { subscriptionId: id, sessionId, path, event });
      else sender.send('files:resource-changed', id);
    };
    const begin = (): Promise<void> => {
      current?.abort();
      const generation = new AbortController();
      current = generation;
      const pending = (async () => {
        const root = rootForSession(sessionId);
        if (!root) throw new Error('No workspace is bound to this conversation.');
        await Promise.all([...new Set(paths)].map(path => observeWorkspaceFile(root, path, (event, observed) => {
          if (current === generation && !generation.signal.aborted) notify(event, observed);
        }, generation.signal)));
      })();
      void pending.catch(() => {
        generation.abort();
        // Retain the binding subscription so a later valid root can recover.
        if (current === generation) notify();
      });
      return pending;
    };
    const offWorkspace = onWorkspaceChange(change => {
      if (change.sessionId !== sessionId || controller.signal.aborted) return;
      setup = begin();
      for (const path of paths) notify('change', path);
    });
    const stop = () => { current?.abort(); offWorkspace(); };
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      setup = begin();
      // Binding may change during discovery; only current readiness counts.
      for (;;) {
        const pending = setup;
        try { await pending; } catch (error) {
          if (pending === setup) throw error;
        }
        if (pending === setup || controller.signal.aborted) break;
      }
    } catch (error) {
      controller.abort();
      if (owner.subscriptions.get(key) === controller) owner.subscriptions.delete(key);
      if (!owner.subscriptions.size) owner.release();
      throw error;
    }
  }
  function stop(sender: WebContents, key: string) {
    const owner = owners.get(sender.id);
    owner?.subscriptions.get(key)?.abort();
    owner?.subscriptions.delete(key);
    if (owner && !owner.subscriptions.size) owner.release();
  }

  ipcMain.handle('files:observe-resource', (event, args: { id: string; sessionId: string; path: string }) =>
    observe(event.sender, args.id, args.sessionId, [args.path]));
  ipcMain.handle('files:unobserve-resource', (event, id: string) => stop(event.sender, `resource:${id}`));
  ipcMain.handle('files:watch', (event, args: { subscriptionId: string; sessionId: string; paths: string[] }) => {
    if (!Array.isArray(args.paths)) throw new Error('Invalid file watch subscription.');
    return observe(event.sender, args.subscriptionId, args.sessionId, args.paths.slice(0, 32), true);
  });
  ipcMain.handle('files:unwatch', (event, id: string) => stop(event.sender, `watch:${id}`));
}
