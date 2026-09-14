import type { IpcMain, WebContents } from 'electron';
import { dirname, resolve as resolvePath } from 'node:path';
import type { WorkspaceDocumentReadRequest, WorkspaceDocumentReadResult } from '@amiba/app-runtime/platform';
type Args = { id: string; sessionId: string; path: string; request: WorkspaceDocumentReadRequest };
function valid(value: unknown): value is Args {
  if (!value || typeof value !== 'object') return false;
  const args = value as Partial<Args>;
  return typeof args.id === 'string' && !!args.id && typeof args.sessionId === 'string' && !!args.sessionId && typeof args.path === 'string' && !!args.path.trim() && !!args.request && typeof args.request === 'object' && ['text', 'bytes', 'all'].includes(args.request.kind);
}
function failed(code: string, message: string, details: Readonly<Record<string, unknown>> = {}, name = 'Error'): WorkspaceDocumentReadResult {
  return { ok: false, error: { name, code, message, details } };
}
/** Each request belongs to its originating document; navigation cancels in-flight I/O. */
export function registerDocumentFileIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  resolve: (sessionId: string, path: string) => Promise<{ path: string }>,
  read: typeof import('./document-file-reader').readDocumentFile,
): void {
  const owners = new Map<number, { requests: Map<string, AbortController>; release(): void }>();
  function ownerFor(sender: WebContents) {
    const existing = owners.get(sender.id);
    if (existing) return existing;
    const requests = new Map<string, AbortController>();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const request of requests.values()) request.abort();
      requests.clear(); owners.delete(sender.id);
      sender.removeListener('destroyed', release);
      sender.removeListener('did-start-navigation', navigating);
    };
    const navigating = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) release();
    };
    const owner = { requests, release };
    owners.set(sender.id, owner);
    sender.once('destroyed', release); sender.on('did-start-navigation', navigating);
    return owner;
  }
  ipcMain.handle('files:read-document', async (event, args: unknown): Promise<WorkspaceDocumentReadResult> => {
    if (!valid(args)) return failed('gateway/bad-request', 'Invalid document read request');
    const relative = args.request.kind === 'all' ? args.request.relativePath : undefined;
    if (relative !== undefined && (typeof relative !== 'string' || !relative || /^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(relative) || relative.includes('\0'))) {
      return failed('gateway/bad-request', 'relativePath must be a relative filesystem path');
    }
    if (event.sender.isDestroyed()) return failed('ABORT_ERR', 'Document was closed', {}, 'AbortError');
    const owner = ownerFor(event.sender);
    if (owner.requests.has(args.id)) return failed('gateway/bad-request', 'Duplicate document read request');
    const controller = new AbortController();
    owner.requests.set(args.id, controller);
    try {
      let resolved = await resolve(args.sessionId, args.path);
      controller.signal.throwIfAborted();
      if (relative !== undefined) {
        // Resolve from the canonical base, then authorize the dependency independently.
        resolved = await resolve(args.sessionId, resolvePath(dirname(resolved.path), relative.replace(/\\/g, '/')));
        controller.signal.throwIfAborted();
      }
      const value = await read(resolved, relative === undefined ? args.request : { kind: 'all' }, controller.signal);
      controller.signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      if (controller.signal.aborted) return failed('ABORT_ERR', 'Document read cancelled', {}, 'AbortError');
      const cause = error as { name?: string; code?: string; message?: string; details?: Record<string, unknown> } | null;
      if (cause?.code === 'ENOENT') return failed('workspace-file/not-found', 'Document does not exist', { path: args.path });
      if (cause?.message === "The requested file is outside this conversation's workspace.") return failed('workspace-file/outside-workspace', cause.message, { path: args.path });
      return failed(cause?.code ?? 'workspace-file/read-failed', cause?.message ?? String(error), cause?.details ?? { path: args.path }, cause?.name ?? 'Error');
    } finally {
      owner.requests.delete(args.id);
      if (!owner.requests.size) owner.release();
    }
  });
  ipcMain.handle('files:cancel-document', (event, id: unknown) => {
    if (typeof id === 'string') owners.get(event.sender.id)?.requests.get(id)?.abort();
  });
}
