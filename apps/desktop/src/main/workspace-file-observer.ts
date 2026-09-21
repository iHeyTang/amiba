import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';

/** Resolve a watch target that may not exist yet. Every existing ancestor is
 * resolved through realpath; dangling symlinks are not treated as missing
 * directories. This permits observation only, never authorizes a later read.
 */
export async function resolveWorkspaceWatchPath(workspaceRoot: string, candidate: string) {
  if (!candidate || !candidate.trim()) throw new Error('A file path is required.');
  const root = await fs.realpath(workspaceRoot);
  const requested = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
  let ancestor = requested;
  const missing: string[] = [];
  let resolved: string;
  while (true) {
    try {
      resolved = await fs.realpath(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // realpath also fails for an existing dangling symlink. Never append a
      // missing suffix across such a link, whose eventual target is unknown.
      const entry = await fs.lstat(ancestor).catch((lstatError: NodeJS.ErrnoException) => {
        if (lstatError.code === 'ENOENT') return undefined;
        throw lstatError;
      });
      if (entry) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The requested file is outside this conversation's workspace.");
  }
  const info = await fs.stat(resolved);
  if (missing.length ? !info.isDirectory() : !info.isFile()) {
    throw new Error('The selected workspace resource is not a file.');
  }
  return { root, path: path.join(resolved, ...missing) };
}

export type WorkspaceFileEvent = "add" | "change" | "unlink";
type Changed = (event: WorkspaceFileEvent, path: string) => void;
interface SharedObservation {
  controller: AbortController;
  listeners: Set<Changed>;
  ready: Promise<() => Promise<void>>;
}
const observations = new Map<string, SharedObservation>();

/** Watch precisely one authorized target, including a not-yet-created file.
 * The ready promise resolves after initial discovery, before the caller's
 * initial stat. Notifications are invalidations: callers reauthorize reads.
 */
export async function observeWorkspaceFile(
  workspaceRoot: string,
  candidate: string,
  changed: Changed,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  // Authorize each subscription before sharing its underlying native watcher.
  const resolved = await resolveWorkspaceWatchPath(workspaceRoot, candidate);
  if (signal.aborted) return async () => {};
  const key = JSON.stringify([resolved.root, resolved.path]);
  let shared = observations.get(key);
  if (!shared) {
    const controller = new AbortController();
    const listeners = new Set<Changed>();
    shared = {
      controller, listeners,
      ready: observeResolvedFile(resolved, (event, path) => {
        for (const listener of listeners) listener(event, path);
      }, controller.signal),
    };
    observations.set(key, shared);
  }
  const entry = shared;
  // A distinct listener also supports duplicate subscriptions using one callback.
  const listener: Changed = (event, path) => changed(event, path);
  entry.listeners.add(listener);
  let released = false;
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (released) return closing ?? Promise.resolve();
    released = true;
    signal.removeEventListener('abort', aborted);
    entry.listeners.delete(listener);
    if (!entry.listeners.size) {
      if (observations.get(key) === entry) observations.delete(key);
      entry.controller.abort();
      closing = entry.ready.then(close => close(), () => {});
    }
    return closing ?? Promise.resolve();
  };
  const aborted = () => { void dispose(); };
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) await dispose();
  try {
    await entry.ready;
    return dispose;
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function observeResolvedFile(
  resolved: { root: string; path: string },
  changed: Changed,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  if (signal.aborted) return async () => {};
  const watcher = chokidar.watch(resolved.root, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    disableGlobbing: true,
    // Only descend along the target's ancestor chain. Watching the root here
    // also catches creation of several initially missing parent directories;
    // siblings and descendants of a target replaced by a directory are ignored.
    ignored: observed => {
      const absolute = path.resolve(observed);
      return absolute !== resolved.path && !resolved.path.startsWith(absolute.endsWith(path.sep) ? absolute : `${absolute}${path.sep}`);
    },
    atomic: false,
  });
  let stopped = false;
  let closing: Promise<void> | undefined;
  let ready: () => void = () => {};
  const dispose = (): Promise<void> => {
    if (closing) return closing;
    stopped = true;
    signal.removeEventListener('abort', aborted);
    ready();
    closing = watcher.close();
    return closing;
  };
  const aborted = () => { void dispose(); };
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) await dispose();
  watcher.on('all', (event, observed) => {
    // A file replaced by a directory must invalidate its preview as well.
    const fileEvent = event === 'addDir' ? 'change' : event === 'unlinkDir' ? 'unlink' : event;
    if (!stopped && path.resolve(observed) === resolved.path &&
        (fileEvent === 'add' || fileEvent === 'change' || fileEvent === 'unlink')) {
      changed(fileEvent, resolved.path);
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      ready = resolve;
      if (stopped) { resolve(); return; }
      watcher.once('ready', resolve);
      // Keep an error listener for the whole lifetime; after readiness an
      // invalidation lets the caller's metadata reconciliation report errors.
      watcher.on('error', error => { if (!stopped) changed('change', resolved.path); reject(error); });
    });
    return dispose;
  } catch (error) {
    await dispose();
    throw error;
  }
}
